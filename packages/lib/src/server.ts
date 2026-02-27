import {
    mutationGeneric,
    queryGeneric,
    GenericMutationCtx,
    GenericQueryCtx,
    GenericDataModel,
} from "convex/server";
import { v } from "convex/values";
import { OnboardingDefinition, OnboardingStatus, OnboardingHandlerContext } from "./types";

export type ConvexOnboardingsConfig<DataModel extends GenericDataModel, EntityType> = {
    onboardings: OnboardingDefinition<DataModel, EntityType, any>[];
    getEntity?: (ctx: GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>) => Promise<EntityType | null>;
    onComplete?: (entity: EntityType, ctx: GenericMutationCtx<DataModel>, onboarding: OnboardingDefinition<DataModel, EntityType, any>) => Promise<void>;
    onAllRequiredComplete?: (entity: EntityType, ctx: GenericMutationCtx<DataModel>) => Promise<void>;
};

type OnboardingRecord = {
    _id: any;
    entityId: string;
    id: string;
    version: number;
    state: "completed" | "skipped";
    completedAt?: number;
    skippedAt?: number;
};

export const convexOnboardings = <DataModel extends GenericDataModel, EntityType>(
    config: ConvexOnboardingsConfig<DataModel, EntityType>
) => {

    const getEntity = config.getEntity ?? (async (ctx: any) => {
        try {
            const { getAuthUserId } = await import("@convex-dev/auth/server");
            const entityId = await getAuthUserId(ctx);
            if (!entityId) return null;
            return ctx.db.get(entityId);
        } catch {
            throw new Error("getEntity not provided and @convex-dev/auth not found.");
        }
    });

    const markOnboarding = async (ctx: GenericMutationCtx<DataModel>, entity: any, id: string, version: number, state: "completed" | "skipped") => {
        const existing = (await ctx.db
            .query("onboardings" as any)
            .withIndex("byEntityIdAndId" as any, (q: any) => q.eq("entityId", entity._id).eq("id", id))
            .unique()) as OnboardingRecord | null;

        if (existing) {
            await ctx.db.patch(existing._id as any, {
                version,
                state,
                completedAt: state === "completed" ? Date.now() : existing.completedAt,
                skippedAt: state === "skipped" ? Date.now() : existing.skippedAt,
            } as any);
        } else {
            await ctx.db.insert("onboardings" as any, {
                entityId: entity._id,
                id,
                version,
                state,
                completedAt: state === "completed" ? Date.now() : undefined,
                skippedAt: state === "skipped" ? Date.now() : undefined,
            } as any);
        }
    };

    const getStatus = async (ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>, entity: any, onboarding: OnboardingDefinition<DataModel, EntityType, any>): Promise<OnboardingStatus> => {
        const record = (await ctx.db
            .query("onboardings" as any)
            .withIndex("byEntityIdAndId" as any, (q: any) => q.eq("entityId", entity._id).eq("id", onboarding.id))
            .unique()) as OnboardingRecord | null;

        const condition = onboarding.condition ? await onboarding.condition(entity, ctx) : true;

        if (!record) {
            return {
                id: onboarding.id,
                name: onboarding.name,
                description: onboarding.description,
                version: onboarding.version,
                required: onboarding.required,
                optIn: onboarding.optIn,
                state: "pending",
                completedVersion: null,
                completedAt: null,
                skippedAt: null,
                completed: false,
                skipped: false,
                outdated: false,
                visible: condition,
            };
        }

        const state = record.version !== onboarding.version && record.state === "completed" ? "outdated" : record.state;

        return {
            id: onboarding.id,
            name: onboarding.name,
            description: onboarding.description,
            version: onboarding.version,
            required: onboarding.required,
            optIn: onboarding.optIn,
            state,
            completedVersion: record.version,
            completedAt: record.completedAt ?? null,
            skippedAt: record.skippedAt ?? null,
            completed: state === "completed",
            skipped: state === "skipped",
            outdated: state === "outdated",
            visible: condition,
        };
    };

    const handleAllRequiredComplete = async (ctx: GenericMutationCtx<DataModel>, entity: any) => {
        if (config.onAllRequiredComplete) {
            const statuses = await Promise.all(config.onboardings.map(o => getStatus(ctx, entity, o)));
            const allRequiredComplete = statuses.filter(s => s.required).every(s => s.completed || !s.visible);
            if (allRequiredComplete) {
                await config.onAllRequiredComplete(entity, ctx);
            }
        }
    };

    const createHandlerContext = (ctx: GenericMutationCtx<DataModel>, entity: any, onboarding: OnboardingDefinition<DataModel, EntityType, any>): OnboardingHandlerContext => {
        return {
            complete: async () => {
                await markOnboarding(ctx, entity, onboarding.id, onboarding.version, "completed");
                if (config.onComplete) {
                    await config.onComplete(entity, ctx, onboarding);
                }
                await handleAllRequiredComplete(ctx, entity);
            },
            skip: async () => {
                if (!onboarding.optIn) throw new Error("Cannot skip a mandatory onboarding");
                await markOnboarding(ctx, entity, onboarding.id, onboarding.version, "skipped");
                await handleAllRequiredComplete(ctx, entity);
            },
            isComplete: async (otherId: string) => {
                const other = config.onboardings.find(o => o.id === otherId);
                if (!other) throw new Error(`Onboarding ${otherId} not found`);
                const status = await getStatus(ctx, entity, other);
                return status.completed;
            },
            completeOther: async (otherId: string) => {
                const other = config.onboardings.find(o => o.id === otherId);
                if (!other) throw new Error(`Onboarding ${otherId} not found`);
                await markOnboarding(ctx, entity, other.id, other.version, "completed");
                if (config.onComplete) {
                    await config.onComplete(entity, ctx, other);
                }
                await handleAllRequiredComplete(ctx, entity);
            }
        };
    };

    return {
        onboard: mutationGeneric({
            args: {
                id: v.string(),
                data: v.any(),
            },
            handler: async (ctx, args) => {
                const entity = await getEntity(ctx);
                if (!entity) throw new Error("Unauthorized");

                const onboarding = config.onboardings.find(o => o.id === args.id);
                if (!onboarding) throw new Error("Onboarding not found");

                const handlerCtx = createHandlerContext(ctx, entity, onboarding);
                await onboarding.handle(entity, ctx, args.data, handlerCtx);
            }
        }),
        list: queryGeneric({
            args: {},
            handler: async (ctx) => {
                const entity = await getEntity(ctx);
                if (!entity) return [];

                return Promise.all(config.onboardings.map(o => getStatus(ctx, entity, o)));
            }
        }),
        status: queryGeneric({
            args: { id: v.string() },
            handler: async (ctx, args) => {
                const entity = await getEntity(ctx);
                if (!entity) return null;

                const onboarding = config.onboardings.find(o => o.id === args.id);
                if (!onboarding) throw new Error("Onboarding not found");

                return getStatus(ctx, entity, onboarding);
            }
        }),
        skip: mutationGeneric({
            args: { id: v.string() },
            handler: async (ctx, args) => {
                const entity = await getEntity(ctx);
                if (!entity) throw new Error("Unauthorized");

                const onboarding = config.onboardings.find(o => o.id === args.id);
                if (!onboarding) throw new Error("Onboarding not found");

                if (!onboarding.optIn) throw new Error("Cannot skip a mandatory onboarding");

                const handlerCtx = createHandlerContext(ctx, entity, onboarding);
                await handlerCtx.skip();
            }
        }),
        reset: mutationGeneric({
            args: { id: v.string() },
            handler: async (ctx, args) => {
                const entity = await getEntity(ctx);
                if (!entity) throw new Error("Unauthorized");

                const record = (await ctx.db
                    .query("onboardings" as any)
                    .withIndex("byEntityIdAndId" as any, (q: any) => q.eq("entityId", (entity as any)._id).eq("id", args.id))
                    .unique()) as OnboardingRecord | null;

                if (record) {
                    await ctx.db.delete(record._id as any);
                }
            }
        }),
        complete: mutationGeneric({
            args: { id: v.string() },
            handler: async (ctx, args) => {
                const entity = await getEntity(ctx);
                if (!entity) throw new Error("Unauthorized");

                const onboarding = config.onboardings.find(o => o.id === args.id);
                if (!onboarding) throw new Error("Onboarding not found");

                const handlerCtx = createHandlerContext(ctx, entity, onboarding);
                await handlerCtx.complete();
            }
        }),
        allComplete: queryGeneric({
            args: {},
            handler: async (ctx) => {
                const entity = await getEntity(ctx);
                if (!entity) return false;

                const statuses = await Promise.all(config.onboardings.map(o => getStatus(ctx, entity, o)));
                return statuses.filter(s => s.required).every(s => s.completed || !s.visible);
            }
        }),
    };
};
