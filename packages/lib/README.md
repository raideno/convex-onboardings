# Convex Onboardings Package

A reusable package for managing, tracking, and executing robust onboarding flows inside your Convex backend. 

## Features
- **Extensible Workflows**: Create arbitrary onboarding flows tracking data dependencies.
- **Client React Hooks**: Access all onboardings directly from your clients.
- **Backend Driven**: Validate actions safely in your robust Convex backend.

## Installation

```bash
npm install @raideno/convex-onboardings
```

## Setup

First, include the predefined schema in your `convex/schema.ts` tables:

```ts
import { defineSchema, defineTable } from "convex/server";
import { onboardingsSchema } from "@raideno/convex-onboardings/schema";

export default defineSchema({
  ...onboardingsSchema,
  /*
   * Your app tables...
   */
});
```

Define any onboarding flows using `defineOnboarding`:

```ts
// convex/onboardings.definitions.ts
import { defineOnboarding } from "@raideno/convex-onboardings";
import { v } from "convex/values";

export const profileOnboarding = defineOnboarding({
  id: "profile",
  version: 1,
  name: "Profile Setup",
  description: "Set up your user profile.",

  required: false,
  optIn: true,

  // Condition controls when this step is visible/applicable
  condition: async (entity, ctx) => {
    return true; 
  },

  args: v.object({
    name: v.string(),
    email: v.string(),
  }),

  handle: async (entity, ctx, args, onboarding) => {
    await ctx.db.patch(entity._id, {
      name: args.name,
      email: args.email,
    });
    
    // Explicitly resolve the onboarding
    await onboarding.complete(); 
  },
});
```

Connect it to your API via `convexOnboardings` (e.g in `convex/onboardings.ts`):

```ts
// convex/onboardings.ts
import { convexOnboardings } from "@raideno/convex-onboardings/server";
import { createOnboardingHooks } from "@raideno/convex-onboardings/client";
import { profileOnboarding } from "./onboardings.definitions";

// (Optional) custom entity resolver resolver
const getEntity = async (ctx) => {
    // If empty it defaults to importing `getAuthUserId` from @convex-dev/auth/server!
    return null; 
}

export const { onboard, list, status, skip, reset, complete, allComplete } = convexOnboardings({
    onboardings: [profileOnboarding],
    getEntity,
    onComplete: async (entity, ctx, onboarding) => {
        // Run logic each time an onboarding finishes
    },
    onAllRequiredComplete: async (entity, ctx) => {
        // Fired when the entity finishes all required onboardings
    }
});

// Easily export your frontend hooks!
export const { 
    useOnboardings, 
    useOnboarding, 
    useOnboard, 
    useSkip,
    useComplete, 
    useReset, 
    useAllComplete 
} = createOnboardingHooks({
  onboard, list, status, skip, reset, complete, allComplete
});
```

## React Usage Example

```tsx
import { useOnboardings, useOnboard } from "~/convex/onboardings";

function OnboardingFlow() {
  const onboardings = useOnboardings();       
  const onboard = useOnboard();

  const pending = onboardings?.filter(o => !o.completed && !o.skipped && o.visible);
  const current = pending?.[0];

  if (!current) return null;

  return (
    <OnboardingStep
      onboarding={current}
      onSubmit={(data) => onboard({ id: current.id, data })}
    />
  );
}
```

## Handlers Mechanics

Within `handle`, the package exposes an `onboarding` context to interact programmatically:

```ts
handle: async (entity, ctx, args, onboarding) => {
  // Mark as done
  await onboarding.complete();

  // Skip it (for opt-in onboardings only)
  await onboarding.skip();

  // Access sibling onboarding states
  const profileDone = await onboarding.isComplete("profile");

  // Manually complete another onboarding from within this one
  await onboarding.completeOther("welcome");
}
```
