/* global module */
// Stands in for the `function-bind` package, which the Keystone UR
// libraries pull in through `assert` and `call-bind`. That package
// exports the native bind when it exists and otherwise a fallback built
// with `Function(...)`, which MV3's CSP refuses. Every supported Chrome
// has the native bind, so only it ships.
module.exports = Function.prototype.bind;
