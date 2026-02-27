import {
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDataModel,
} from "convex/server";
import {
  OnboardingDefinition,
  OnboardingStatus,
  OnboardingHandlerContext,
} from "./types";

export type ConvexOnboardingsConfig<DataModel extends GenericDataModel> = {
  onboardings: OnboardingDefinition<DataModel, any>[];
  onComplete?: (
    entityId: string,
    ctx: GenericMutationCtx<DataModel>,
    onboarding: OnboardingDefinition<DataModel, any>,
  ) => Promise<void>;
  onAllRequiredComplete?: (
    entityId: string,
    ctx: GenericMutationCtx<DataModel>,
  ) => Promise<void>;
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

export const convexOnboardings = <DataModel extends GenericDataModel>(
  config: ConvexOnboardingsConfig<DataModel>,
) => {
  const markOnboarding = async (
    ctx: GenericMutationCtx<DataModel>,
    entityId: string,
    id: string,
    version: number,
    state: "completed" | "skipped",
  ) => {
    const existing = (await ctx.db
      .query("onboardings" as any)
      .withIndex("byEntityIdAndId" as any, (q: any) =>
        q.eq("entityId", entityId).eq("id", id),
      )
      .unique()) as OnboardingRecord | null;

    if (existing) {
      await ctx.db.patch(
        existing._id as any,
        {
          version,
          state,
          completedAt:
            state === "completed" ? Date.now() : existing.completedAt,
          skippedAt: state === "skipped" ? Date.now() : existing.skippedAt,
        } as any,
      );
    } else {
      await ctx.db.insert(
        "onboardings" as any,
        {
          entityId,
          id,
          version,
          state,
          completedAt: state === "completed" ? Date.now() : undefined,
          skippedAt: state === "skipped" ? Date.now() : undefined,
        } as any,
      );
    }
  };

  const getStatus = async (
    ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
    entityId: string,
    onboarding: OnboardingDefinition<DataModel, any>,
  ): Promise<OnboardingStatus> => {
    const record = (await ctx.db
      .query("onboardings" as any)
      .withIndex("byEntityIdAndId" as any, (q: any) =>
        q.eq("entityId", entityId).eq("id", onboarding.id),
      )
      .unique()) as OnboardingRecord | null;

    const condition = onboarding.condition
      ? await onboarding.condition(entityId, ctx)
      : true;

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

    const state =
      record.version !== onboarding.version && record.state === "completed"
        ? "outdated"
        : record.state;

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

  const handleAllRequiredComplete = async (
    ctx: GenericMutationCtx<DataModel>,
    entityId: string,
  ) => {
    if (config.onAllRequiredComplete) {
      const statuses = await Promise.all(
        config.onboardings.map((o) => getStatus(ctx, entityId, o)),
      );
      const allRequiredComplete = statuses
        .filter((s) => s.required)
        .every((s) => s.completed || !s.visible);
      if (allRequiredComplete) {
        await config.onAllRequiredComplete(entityId, ctx);
      }
    }
  };

  const createHandlerContext = (
    ctx: GenericMutationCtx<DataModel>,
    entityId: string,
    onboarding: OnboardingDefinition<DataModel, any>,
  ): OnboardingHandlerContext => {
    return {
      complete: async () => {
        await markOnboarding(
          ctx,
          entityId,
          onboarding.id,
          onboarding.version,
          "completed",
        );
        if (config.onComplete) {
          await config.onComplete(entityId, ctx, onboarding);
        }
        await handleAllRequiredComplete(ctx, entityId);
      },
      skip: async () => {
        if (!onboarding.optIn)
          throw new Error("Cannot skip a mandatory onboarding");
        await markOnboarding(
          ctx,
          entityId,
          onboarding.id,
          onboarding.version,
          "skipped",
        );
        await handleAllRequiredComplete(ctx, entityId);
      },
      isComplete: async (otherId: string) => {
        const other = config.onboardings.find((o) => o.id === otherId);
        if (!other) throw new Error(`Onboarding ${otherId} not found`);
        const status = await getStatus(ctx, entityId, other);
        return status.completed;
      },
      completeOther: async (otherId: string) => {
        const other = config.onboardings.find((o) => o.id === otherId);
        if (!other) throw new Error(`Onboarding ${otherId} not found`);
        await markOnboarding(
          ctx,
          entityId,
          other.id,
          other.version,
          "completed",
        );
        if (config.onComplete) {
          await config.onComplete(entityId, ctx, other);
        }
        await handleAllRequiredComplete(ctx, entityId);
      },
    };
  };

  return {
    /**
     * Runs an onboarding's handler for the given entity.
     * Call this from your own mutation after resolving the entityId.
     */
    onboard: async (
      ctx: GenericMutationCtx<DataModel>,
      entityId: string,
      id: string,
      data: any,
    ): Promise<void> => {
      const onboarding = config.onboardings.find((o) => o.id === id);
      if (!onboarding) throw new Error(`Onboarding "${id}" not found`);

      const handlerCtx = createHandlerContext(ctx, entityId, onboarding);
      await onboarding.handle(entityId, ctx, data, handlerCtx);
    },

    /**
     * Returns all onboarding statuses for the given entity.
     * Call this from your own query after resolving the entityId.
     */
    list: async (
      ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
      entityId: string,
    ): Promise<OnboardingStatus[]> => {
      return Promise.all(
        config.onboardings.map((o) => getStatus(ctx, entityId, o)),
      );
    },

    /**
     * Returns the status of a single onboarding for the given entity.
     * Call this from your own query after resolving the entityId.
     */
    status: async (
      ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
      entityId: string,
      id: string,
    ): Promise<OnboardingStatus> => {
      const onboarding = config.onboardings.find((o) => o.id === id);
      if (!onboarding) throw new Error(`Onboarding "${id}" not found`);
      return getStatus(ctx, entityId, onboarding);
    },

    /**
     * Skips an opt-in onboarding for the given entity.
     * Call this from your own mutation after resolving the entityId.
     */
    skip: async (
      ctx: GenericMutationCtx<DataModel>,
      entityId: string,
      id: string,
    ): Promise<void> => {
      const onboarding = config.onboardings.find((o) => o.id === id);
      if (!onboarding) throw new Error(`Onboarding "${id}" not found`);
      if (!onboarding.optIn)
        throw new Error("Cannot skip a mandatory onboarding");

      const handlerCtx = createHandlerContext(ctx, entityId, onboarding);
      await handlerCtx.skip();
    },

    /**
     * Resets (deletes) an onboarding record for the given entity,
     * returning it to "pending" state.
     * Call this from your own mutation after resolving the entityId.
     */
    reset: async (
      ctx: GenericMutationCtx<DataModel>,
      entityId: string,
      id: string,
    ): Promise<void> => {
      const record = (await ctx.db
        .query("onboardings" as any)
        .withIndex("byEntityIdAndId" as any, (q: any) =>
          q.eq("entityId", entityId).eq("id", id),
        )
        .unique()) as OnboardingRecord | null;

      if (record) {
        await ctx.db.delete(record._id as any);
      }
    },

    /**
     * Directly marks an onboarding as completed for the given entity,
     * bypassing its handler. Useful for programmatic completion.
     * Call this from your own mutation after resolving the entityId.
     */
    complete: async (
      ctx: GenericMutationCtx<DataModel>,
      entityId: string,
      id: string,
    ): Promise<void> => {
      const onboarding = config.onboardings.find((o) => o.id === id);
      if (!onboarding) throw new Error(`Onboarding "${id}" not found`);

      const handlerCtx = createHandlerContext(ctx, entityId, onboarding);
      await handlerCtx.complete();
    },

    /**
     * Returns true if all required onboardings are completed (or not visible)
     * for the given entity.
     * Call this from your own query after resolving the entityId.
     */
    allComplete: async (
      ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
      entityId: string,
    ): Promise<boolean> => {
      const statuses = await Promise.all(
        config.onboardings.map((o) => getStatus(ctx, entityId, o)),
      );
      return statuses
        .filter((s) => s.required)
        .every((s) => s.completed || !s.visible);
    },
  };
};
