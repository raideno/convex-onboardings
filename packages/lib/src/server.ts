import {
    mutationGeneric,
    queryGeneric,
    GenericMutationCtx,
    GenericQueryCtx,
    GenericDataModel,
} from "convex/server";
import { v } from "convex/values";
import { OnboardingDefinition, OnboardingStatus, OnboardingHandlerContext } from "./types";

export type ConvexOnboardingsConfig<DataModel extends GenericDataModel, UserType> = {
    onboardings: OnboardingDefinition<DataModel, UserType, any>[];
    getUser?: (ctx: GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>) => Promise<UserType | null>;
    onComplete?: (user: UserType, ctx: GenericMutationCtx<DataModel>, onboarding: OnboardingDefinition<DataModel, UserType, any>) => Promise<void>;
    onAllRequiredComplete?: (user: UserType, ctx: GenericMutationCtx<DataModel>) => Promise<void>;
};

type OnboardingRecord = {
    _id: any;
    userId: any;
    id: string;
    version: number;
    state: "completed" | "skipped";
    completedAt?: number;
    skippedAt?: number;
};

export const convexOnboardings = <DataModel extends GenericDataModel, UserType>(
    config: ConvexOnboardingsConfig<DataModel, UserType>
) => {

    const getUser = config.getUser ?? (async (ctx: any) => {
        try {
            const { getAuthUserId } = await import("@convex-dev/auth/server");
            const userId = await getAuthUserId(ctx);
            if (!userId) return null;
            return ctx.db.get(userId);
        } catch {
            throw new Error("getUser not provided and @convex-dev/auth not found.");
        }
    });

    const markOnboarding = async (ctx: GenericMutationCtx<DataModel>, user: any, id: string, version: number, state: "completed" | "skipped") => {
        const existing = (await ctx.db
            .query("onboardings" as any)
            .withIndex("byUserIdAndId" as any, (q: any) => q.eq("userId", user._id).eq("id", id))
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
                userId: user._id,
                id,
                version,
                state,
                completedAt: state === "completed" ? Date.now() : undefined,
                skippedAt: state === "skipped" ? Date.now() : undefined,
            } as any);
        }
    };

    const getStatus = async (ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>, user: any, onboarding: OnboardingDefinition<DataModel, UserType, any>): Promise<OnboardingStatus> => {
        const record = (await ctx.db
            .query("onboardings" as any)
            .withIndex("byUserIdAndId" as any, (q: any) => q.eq("userId", user._id).eq("id", onboarding.id))
            .unique()) as OnboardingRecord | null;

        const condition = onboarding.condition ? await onboarding.condition(user, ctx) : true;

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

    const handleAllRequiredComplete = async (ctx: GenericMutationCtx<DataModel>, user: any) => {
        if (config.onAllRequiredComplete) {
            const statuses = await Promise.all(config.onboardings.map(o => getStatus(ctx, user, o)));
            const allRequiredComplete = statuses.filter(s => s.required).every(s => s.completed || !s.visible);
            if (allRequiredComplete) {
                await config.onAllRequiredComplete(user, ctx);
            }
        }
    };

    const createHandlerContext = (ctx: GenericMutationCtx<DataModel>, user: any, onboarding: OnboardingDefinition<DataModel, UserType, any>): OnboardingHandlerContext => {
        return {
            complete: async () => {
                await markOnboarding(ctx, user, onboarding.id, onboarding.version, "completed");
                if (config.onComplete) {
                    await config.onComplete(user, ctx, onboarding);
                }
                await handleAllRequiredComplete(ctx, user);
            },
            skip: async () => {
                if (!onboarding.optIn) throw new Error("Cannot skip a mandatory onboarding");
                await markOnboarding(ctx, user, onboarding.id, onboarding.version, "skipped");
                await handleAllRequiredComplete(ctx, user);
            },
            isComplete: async (otherId: string) => {
                const other = config.onboardings.find(o => o.id === otherId);
                if (!other) throw new Error(`Onboarding ${otherId} not found`);
                const status = await getStatus(ctx, user, other);
                return status.completed;
            },
            completeOther: async (otherId: string) => {
                const other = config.onboardings.find(o => o.id === otherId);
                if (!other) throw new Error(`Onboarding ${otherId} not found`);
                await markOnboarding(ctx, user, other.id, other.version, "completed");
                if (config.onComplete) {
                    await config.onComplete(user, ctx, other);
                }
                await handleAllRequiredComplete(ctx, user);
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
                const user = await getUser(ctx);
                if (!user) throw new Error("Unauthorized");

                const onboarding = config.onboardings.find(o => o.id === args.id);
                if (!onboarding) throw new Error("Onboarding not found");

                const handlerCtx = createHandlerContext(ctx, user, onboarding);
                await onboarding.handle(user, ctx, args.data, handlerCtx);
            }
        }),
        list: queryGeneric({
            args: {},
            handler: async (ctx) => {
                const user = await getUser(ctx);
                if (!user) return [];

                return Promise.all(config.onboardings.map(o => getStatus(ctx, user, o)));
            }
        }),
        status: queryGeneric({
            args: { id: v.string() },
            handler: async (ctx, args) => {
                const user = await getUser(ctx);
                if (!user) return null;

                const onboarding = config.onboardings.find(o => o.id === args.id);
                if (!onboarding) throw new Error("Onboarding not found");

                return getStatus(ctx, user, onboarding);
            }
        }),
        skip: mutationGeneric({
            args: { id: v.string() },
            handler: async (ctx, args) => {
                const user = await getUser(ctx);
                if (!user) throw new Error("Unauthorized");

                const onboarding = config.onboardings.find(o => o.id === args.id);
                if (!onboarding) throw new Error("Onboarding not found");

                if (!onboarding.optIn) throw new Error("Cannot skip a mandatory onboarding");

                const handlerCtx = createHandlerContext(ctx, user, onboarding);
                await handlerCtx.skip();
            }
        }),
        reset: mutationGeneric({
            args: { id: v.string() },
            handler: async (ctx, args) => {
                const user = await getUser(ctx);
                if (!user) throw new Error("Unauthorized");

                const record = (await ctx.db
                    .query("onboardings" as any)
                    .withIndex("byUserIdAndId" as any, (q: any) => q.eq("userId", (user as any)._id).eq("id", args.id))
                    .unique()) as OnboardingRecord | null;

                if (record) {
                    await ctx.db.delete(record._id as any);
                }
            }
        }),
        complete: mutationGeneric({
            args: { id: v.string() },
            handler: async (ctx, args) => {
                const user = await getUser(ctx);
                if (!user) throw new Error("Unauthorized");

                const onboarding = config.onboardings.find(o => o.id === args.id);
                if (!onboarding) throw new Error("Onboarding not found");

                const handlerCtx = createHandlerContext(ctx, user, onboarding);
                await handlerCtx.complete();
            }
        }),
        allComplete: queryGeneric({
            args: {},
            handler: async (ctx) => {
                const user = await getUser(ctx);
                if (!user) return false;

                const statuses = await Promise.all(config.onboardings.map(o => getStatus(ctx, user, o)));
                return statuses.filter(s => s.required).every(s => s.completed || !s.visible);
            }
        }),
    };
};
