import { defineTable } from "convex/server";
import { v } from "convex/values";

export const onboardingsTables = {
  onboardings: defineTable({
    entityId: v.string(),
    id: v.string(),
    version: v.number(),
    state: v.union(v.literal("completed"), v.literal("skipped")),
    completedAt: v.optional(v.number()),
    skippedAt: v.optional(v.number()),
  })
    .index("byEntityIdAndId", ["entityId", "id"])
    .index("by_entityId", ["entityId"]),
};
