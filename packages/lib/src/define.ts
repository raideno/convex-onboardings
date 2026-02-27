import { AnyDataModel, GenericDataModel } from "convex/server";
import { VObject } from "convex/values";

import { OnboardingDefinition } from "./types";

export const defineOnboarding = <
  DataModel extends GenericDataModel = AnyDataModel,
  Args extends VObject<any, any> = VObject<any, any>,
>(
  specification: OnboardingDefinition<DataModel, Args>,
) => specification;
