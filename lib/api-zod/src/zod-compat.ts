import * as zodBase from "zod";

export * from "zod";

export const url = () => zodBase.string().url();
export const uuid = () => zodBase.string().uuid();
export const int = () => zodBase.number().int();
export const looseObject = <Shape extends zodBase.ZodRawShape>(shape: Shape) =>
  zodBase.object(shape).passthrough();