import { useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import type { OnboardingStatus } from "./types";

export function createOnboardingHooks<
    OnboardRef extends FunctionReference<"mutation">,
    ListRef extends FunctionReference<"query">,
    StatusRef extends FunctionReference<"query">,
    SkipRef extends FunctionReference<"mutation">,
    ResetRef extends FunctionReference<"mutation">,
    CompleteRef extends FunctionReference<"mutation">,
    AllCompleteRef extends FunctionReference<"query">
>(apiRef: {
    onboard: OnboardRef;
    list: ListRef;
    status: StatusRef;
    skip: SkipRef;
    reset: ResetRef;
    complete: CompleteRef;
    allComplete: AllCompleteRef;
}) {
    return {
        useOnboardings: () => useQuery(apiRef.list as any) as OnboardingStatus[] | undefined,
        useOnboarding: (id: string) => useQuery(apiRef.status as any, { id }) as OnboardingStatus | null | undefined,
        useOnboard: () => useMutation(apiRef.onboard as any),
        useSkip: () => useMutation(apiRef.skip as any),
        useReset: () => useMutation(apiRef.reset as any),
        useComplete: () => useMutation(apiRef.complete as any),
        useAllComplete: () => useQuery(apiRef.allComplete as any) as boolean | undefined,
    };
}
