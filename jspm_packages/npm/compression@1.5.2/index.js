/* */ 
(function(Buffer) {
  'use strict';
  var accepts = require('accepts');
  var bytes = require('bytes');
  var compressible = require('compressible');
  var debug = require('debug')('compression');
  var onHeaders = require('on-headers');
  var vary = require('vary');
  var zlib = require('zlib');
  module.exports = compression;
  module.exports.filter = shouldCompress;
  function compression(options) {
    var opts = options || {};
    var filter = opts.filter || shouldCompress;
    var threshold = bytes.parse(opts.threshold);
    if (threshold == null) {
      threshold = 1024;
    }
    return function compression(req, res, next) {
      var ended = false;
      var length;
      var listeners = [];
      var write = res.write;
      var on = res.on;
      var end = res.end;
      var stream;
      res.flush = function flush() {
        if (stream) {
          stream.flush();
        }
      };
      res.write = function(chunk, encoding) {
        if (ended) {
          return false;
        }
        if (!this._header) {
          this._implicitHeader();
        }
        return stream ? stream.write(new Buffer(chunk, encoding)) : write.call(this, chunk, encoding);
      };
      res.end = function(chunk, encoding) {
        if (ended) {
          return false;
        }
        if (!this._header) {
          if (!this.getHeader('Content-Length')) {
            length = chunkLength(chunk, encoding);
          }
          this._implicitHeader();
        }
        if (!stream) {
          return end.call(this, chunk, encoding);
        }
        ended = true;
        return chunk ? stream.end(new Buffer(chunk, encoding)) : stream.end();
      };
      res.on = function(type, listener) {
        if (!listeners || type !== 'drain') {
          return on.call(this, type, listener);
        }
        if (stream) {
          return stream.on(type, listener);
        }
        listeners.push([type, listener]);
        return this;
      };
      function nocompress(msg) {
        debug('no compression: %s', msg);
        addListeners(res, on, listeners);
        listeners = null;
      }
      onHeaders(res, function() {
        if (!filter(req, res)) {
          nocompress('filtered');
          return;
        }
        vary(res, 'Accept-Encoding');
        if (Number(res.getHeader('Content-Length')) < threshold || length < threshold) {
          nocompress('size below threshold');
          return;
        }
        var encoding = res.getHeader('Content-Encoding') || 'identity';
        if ('identity' !== encoding) {
          nocompress('already encoded');
          return;
        }
        if ('HEAD' === req.method) {
          nocompress('HEAD request');
          return;
        }
        var accept = accepts(req);
        var method = accept.encoding(['gzip', 'deflate', 'identity']);
        if (method === 'deflate' && accept.encoding(['gzip'])) {
          method = accept.encoding(['gzip', 'identity']);
        }
        if (!method || method === 'identity') {
          nocompress('not acceptable');
          return;
        }
        debug('%s compression', method);
        stream = method === 'gzip' ? zlib.createGzip(opts) : zlib.createDeflate(opts);
        addListeners(stream, stream.on, listeners);
        res.setHeader('Content-Encoding', method);
        res.removeHeader('Content-Length');
        stream.on('data', function(chunk) {
          if (write.call(res, chunk) === false) {
            stream.pause();
          }
        });
        stream.on('end', function() {
          end.call(res);
        });
        on.call(res, 'drain', function() {
          stream.resume();
        });
      });
      next();
    };
  }
  function addListeners(stream, on, listeners) {
    for (var i = 0; i < listeners.length; i++) {
      on.apply(stream, listeners[i]);
    }
  }
  function chunkLength(chunk, encoding) {
    if (!chunk) {
      return 0;
    }
    return !Buffer.isBuffer(chunk) ? Buffer.byteLength(chunk, encoding) : chunk.length;
  }
  function shouldCompress(req, res) {
    var type = res.getHeader('Content-Type');
    if (type === undefined || !compressible(type)) {
      debug('%s not compressible', type);
      return false;
    }
    return true;
  }
})(require('buffer').Buffer);
