import { defineTable } from "convex/server";
import { v } from "convex/values";

export const onboardingsSchema = {
    onboardings: defineTable({
        userId: v.id("users"),
        id: v.string(),
        version: v.number(),
        state: v.union(v.literal("completed"), v.literal("skipped")),
        completedAt: v.optional(v.number()),
        skippedAt: v.optional(v.number()),
    })
        .index("byUserIdAndId", ["userId", "id"])
        .index("by_userId", ["userId"]),
};
