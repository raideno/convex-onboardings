import { VObject } from "convex/values";
import { OnboardingDefinition } from "./types";
import { GenericDataModel, AnyDataModel } from "convex/server";

export const defineOnboarding = <
  Args extends VObject<any, any>,
  DataModel extends GenericDataModel = AnyDataModel,
>(
  specification: OnboardingDefinition<DataModel, Args>,
) => specification;
