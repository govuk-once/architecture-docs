"use strict";
/*
 * Everything the real package exports, replaced by one value that accepts anything:
 * reading a property gives it back, calling it gives it back, constructing it gives it
 * back. GovUKTag.of(x).DataClassification.OFFICIAL_SENSITIVE() and
 * GovUKTag.applyAspect(app, {...}) both run and tag nothing. The primitive conversions
 * are the exceptions, so a tag value that reaches a string lands as "" rather than a
 * TypeError.
 */
const stub = new Proxy(function stub() {}, {
  get(_target, prop) {
    if (
      prop === Symbol.toPrimitive ||
      prop === "toString" ||
      prop === "valueOf"
    )
      return () => "";
    if (typeof prop === "symbol" || prop === "then" || prop === "toJSON")
      return undefined;
    if (prop === "__esModule") return true;
    return stub;
  },
  apply() {
    return stub;
  },
  construct() {
    return stub;
  },
});
module.exports = stub;
