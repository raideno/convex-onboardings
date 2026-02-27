import { VObject, Infer } from "convex/values";
import { GenericMutationCtx, GenericQueryCtx, AnyDataModel, GenericDataModel } from "convex/server";

export type OnboardingStatus = {
    id: string;
    name: string;
    description: string;
    version: number;
    required: boolean;
    optIn: boolean;

    state: "pending" | "completed" | "skipped" | "outdated";
    completedVersion: number | null;
    skippedAt: number | null;
    completedAt: number | null;

    completed: boolean;
    skipped: boolean;
    outdated: boolean;
    visible: boolean;
};

export type OnboardingHandlerContext = {
    complete: () => Promise<void>;
    skip: () => Promise<void>;
    isComplete: (otherId: string) => Promise<boolean>;
    completeOther: (otherId: string) => Promise<void>;
};

export type OnboardingDefinition<
    DataModel extends GenericDataModel = AnyDataModel,
    UserType = any,
    Args extends VObject<any, any> = any
> = {
    id: string;
    name: string;
    description: string;
    version: number;
    required: boolean;
    optIn: boolean;

    condition?: (
        user: UserType,
        ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>
    ) => Promise<boolean> | boolean;

    args: Args;

    handle: (
        user: UserType,
        ctx: GenericMutationCtx<DataModel>,
        args: Infer<Args>,
        onboarding: OnboardingHandlerContext
    ) => void | Promise<void>;
};
