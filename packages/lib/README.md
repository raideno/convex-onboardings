# Convex Onboardings Package

A reusable package for managing, tracking, and executing robust onboarding flows inside your Convex backend.

## Features

- **Extensible Workflows**: Create arbitrary onboarding flows tracking data dependencies.

## Installation
```bash
npm install @raideno/convex-onboardings
```

## Setup

### 1. Schema

Include the predefined table definitions in your `convex/schema.ts`:
```ts
import { defineSchema } from "convex/server";
import { onboardingsTables } from "@raideno/convex-onboardings/schema";

export default defineSchema({
  ...onboardingsTables,
  // your other tables...
});
```

### 2. Define Onboardings

Use `defineOnboarding` to describe each step. The `handle` function receives `entityId` — a plain string you provide — plus a context object with helpers for resolving the onboarding.
```ts
// convex/onboardings.definitions.ts
import { defineOnboarding } from "@raideno/convex-onboardings";
import { v } from "convex/values";

export const profileOnboarding = defineOnboarding({
  id: "profile",
  version: 1,
  name: "Profile Setup",
  description: "Set up your user profile.",

  required: true,
  optIn: false,

  // Optional: control when this step is visible
  condition: async (entityId, ctx) => true,

  args: v.object({
    name: v.string(),
    email: v.string(),
  }),

  handle: async (entityId, ctx, args, onboarding) => {
    await ctx.db.patch(entityId as any, {
      name: args.name,
      email: args.email,
    });

    await onboarding.complete();
  },
});
```

### 3. Wire Up Your API

Create the helper instance with `convexOnboardings`, then write your own Convex mutations and queries that resolve the `entityId` and delegate to the helpers. This gives you full control over authentication.
```ts
// convex/onboardings.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { convexOnboardings } from "@raideno/convex-onboardings/server";
import { profileOnboarding } from "./onboardings.definitions";

// 1. Create the helper — no auth config needed
const onboardings = convexOnboardings({
  onboardings: [profileOnboarding],

  onComplete: async (entityId, ctx, onboarding) => {
    // Runs each time any onboarding is completed
  },
  onAllRequiredComplete: async (entityId, ctx) => {
    // Runs when all required onboardings are done
  },
});

// 2. Write your own mutations/queries and handle auth yourself
export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    return onboardings.list(ctx, identity.subject);
  },
});

export const status = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return onboardings.status(ctx, identity.subject, args.id);
  },
});

export const onboard = mutation({
  args: { id: v.string(), data: v.any() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    return onboardings.onboard(ctx, identity.subject, args.id, args.data);
  },
});

export const skip = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    return onboardings.skip(ctx, identity.subject, args.id);
  },
});

export const reset = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    return onboardings.reset(ctx, identity.subject, args.id);
  },
});

export const complete = mutation({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    return onboardings.complete(ctx, identity.subject, args.id);
  },
});

export const allComplete = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    return onboardings.allComplete(ctx, identity.subject);
  },
});
```

## React Usage
```tsx
import { useOnboardings, useOnboard } from "~/convex/onboardings";

function OnboardingFlow() {
  const onboardings = useOnboardings();
  const onboard = useOnboard();

  const pending = onboardings?.filter(
    (o) => !o.completed && !o.skipped && o.visible,
  );
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

## Handler Context

Within `handle`, the fourth argument exposes helpers:
```ts
handle: async (entityId, ctx, args, onboarding) => {
  // Mark this onboarding as done
  await onboarding.complete();

  // Skip it (only valid when optIn: true)
  await onboarding.skip();

  // Check if another onboarding is already complete
  const profileDone = await onboarding.isComplete("profile");

  // Programmatically complete a different onboarding
  await onboarding.completeOther("welcome");
};
```

## API Reference — Server Helpers

All methods are plain async functions. Call them from inside your own Convex mutations or queries after resolving `entityId`.

| Method                                         | Ctx type          | Description                                              |
| ---------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `onboardings.onboard(ctx, entityId, id, data)` | mutation          | Runs the onboarding's `handle` function                  |
| `onboardings.list(ctx, entityId)`              | query or mutation | Returns all `OnboardingStatus[]`                         |
| `onboardings.status(ctx, entityId, id)`        | query or mutation | Returns a single `OnboardingStatus`                      |
| `onboardings.skip(ctx, entityId, id)`          | mutation          | Skips an opt-in onboarding                               |
| `onboardings.reset(ctx, entityId, id)`         | mutation          | Deletes the record, returning it to pending              |
| `onboardings.complete(ctx, entityId, id)`      | mutation          | Marks an onboarding complete without running its handler |
| `onboardings.allComplete(ctx, entityId)`       | query or mutation | Returns `true` if all required onboardings are done      |

## OnboardingStatus Shape

| Field              | Type                                                  | Description                            |
| ------------------ | ----------------------------------------------------- | -------------------------------------- |
| `id`               | `string`                                              | Onboarding identifier                  |
| `name`             | `string`                                              | Display name                           |
| `description`      | `string`                                              | Description                            |
| `version`          | `number`                                              | Current defined version                |
| `required`         | `boolean`                                             | Whether this onboarding is mandatory   |
| `optIn`            | `boolean`                                             | Whether this onboarding can be skipped |
| `state`            | `"pending" \| "completed" \| "skipped" \| "outdated"` | Current state                          |
| `completedVersion` | `number \| null`                                      | Version at which it was completed      |
| `completedAt`      | `number \| null`                                      | Timestamp of completion                |
| `skippedAt`        | `number \| null`                                      | Timestamp of skip                      |
| `completed`        | `boolean`                                             | Shorthand for `state === "completed"`  |
| `skipped`          | `boolean`                                             | Shorthand for `state === "skipped"`    |
| `outdated`         | `boolean`                                             | Completed at an older version          |
| `visible`          | `boolean`                                             | Whether `condition` resolved to `true` |
