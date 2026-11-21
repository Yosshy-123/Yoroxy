/*
 * Validators for messages that cross a trust boundary (container <-> sandboxed
 * interface, internal pages -> container). Pure functions: no DOM, no state.
 *
 *   A validator is function (value) -> { ok: true, value } | { ok: false }.
 *
 *   Y.validators.V.*                  building blocks: str, bool, int, num,
 *                                     oneOf, nullable, obj, list
 *   Y.validators.checkShape(shape, data, ignore?)
 *                                     data's own keys are exactly shape's keys
 *   Y.validators.validate(table, data)
 *                                     -> clean copy of the message, or null.
 *                                     table: { 'type': shape }
 *   Y.validators.isPlainObject / hasOwn / ok / NO
 *
 * A message is accepted only if it is a plain object whose `type` is a key of
 * the table, whose fields are exactly the declared ones, each of the declared
 * kind and within its length limit. The result is a fresh object built from
 * the validated fields, never the received one.
 */
(function (global) {
  'use strict';

  var Y = (global.Yoroxy = global.Yoroxy || {});

  function isPlainObject(v) {
    if (Object.prototype.toString.call(v) !== '[object Object]') return false;
    var proto = Object.getPrototypeOf(v);
    return proto === null || Object.getPrototypeOf(proto) === null; // Object.prototype of any realm
  }

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function ok(value) { return { ok: true, value: value }; }
  var NO = { ok: false };

  var V = {
    str: function (max) {
      return function (v) { return typeof v === 'string' && v.length <= max ? ok(v) : NO; };
    },
    bool: function (v) { return typeof v === 'boolean' ? ok(v) : NO; },
    int: function (min, max) {
      return function (v) {
        return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= min && v <= max ? ok(v) : NO;
      };
    },
    num: function (min, max) {
      return function (v) { return typeof v === 'number' && isFinite(v) && v >= min && v <= max ? ok(v) : NO; };
    },
    oneOf: function (list) {
      return function (v) { return list.indexOf(v) !== -1 ? ok(v) : NO; };
    },
    nullable: function (inner) {
      return function (v) { return v === null ? ok(null) : inner(v); };
    },
    /* object with exactly these keys (all required) */
    obj: function (shape) {
      return function (v) {
        if (!isPlainObject(v)) return NO;
        return checkShape(shape, v);
      };
    },
    list: function (inner, max) {
      return function (v) {
        if (!Array.isArray(v) || v.length > max) return NO;
        var out = [];
        for (var i = 0; i < v.length; i++) {
          var r = inner(v[i]);
          if (!r.ok) return NO;
          out.push(r.value);
        }
        return ok(out);
      };
    }
  };

  /*
   * data's own keys are exactly shape's keys, each value valid. `ignore` is a
   * key allowed in addition (the message's "type"). The received object's own
   * keys are compared directly: copying them into another object first would
   * let a key such as "__proto__" disappear on the way and pass unnoticed.
   */
  function checkShape(shape, data, ignore) {
    var keys = Object.keys(data).filter(function (k) { return k !== ignore; });
    var wanted = Object.keys(shape);
    if (keys.length !== wanted.length) return NO;
    var out = {};
    for (var i = 0; i < wanted.length; i++) {
      var k = wanted[i];
      if (!hasOwn(data, k)) return NO;
      var r = shape[k](data[k]);
      if (!r.ok) return NO;
      out[k] = r.value;
    }
    return ok(out);
  }

  /* -> clean copy of the message, or null */
  function validate(table, data) {
    if (!isPlainObject(data) || typeof data.type !== 'string' || !hasOwn(table, data.type)) return null;
    var r = checkShape(table[data.type], data, 'type');
    if (!r.ok) return null;
    r.value.type = data.type;
    return r.value;
  }

  Y.validators = Object.freeze({
    V: V,
    ok: ok,
    NO: NO,
    isPlainObject: isPlainObject,
    hasOwn: hasOwn,
    checkShape: checkShape,
    validate: validate
  });
})(window);
