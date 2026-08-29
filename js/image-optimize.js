// Shrink an image in the browser, before it is ever uploaded.
//
// An admin uploaded a 1.77MB sponsor logo and an 865KB hero. Nothing stopped
// them, and three things went wrong at once: the request body carried ~3.5MB of
// base64 towards a 6MB Netlify limit, the function then re-uploaded every one of
// those bytes to GitHub and ran past its 10-second ceiling, and anyone opening
// the finished page on a phone downloaded 2.6MB of pictures.
//
// So the resizing happens HERE, in the browser, not on the server. A server-side
// resize would have fixed the page weight and neither of the other two, because
// the bytes would already have crossed the wire.
//
// The targets match what the site already does by hand: photographs are JPEG at
// 40-85KB (og-image.jpg is 1200×630 at 72KB), logos are PNG at 19-51KB with a
// long edge between 260 and 890px. Nothing here is trying to beat that; it is
// trying to reach it without anybody having to remember.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ImageOptimize = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // Long edge and JPEG quality per slot. The hero is drawn at most ~730 CSS px
  // wide inside the activity layout, so 1600 still covers a 2× screen. Credit
  // photos are drawn in a 40px circle; 600 is far more than they need and keeps
  // them in the same range as the partner logos in images/partners/.
  var PROFILES = {
    hero:   { maxEdge: 1600, quality: 0.82 },
    credit: { maxEdge: 600,  quality: 0.85 },
    // Listing and homepage cards. `square` crops to 1:1 rather than fitting
    // inside a box: a card grid where one tile is 4:3 and the next is 16:9 is
    // the thing the fixed ratio exists to prevent, so the ratio is guaranteed
    // here, at upload, rather than asked for in a hint nobody reads. 800 covers
    // a ~360px tile on a 2× screen.
    card:   { maxEdge: 800,  quality: 0.82, square: true }
  };

  // Scale down to fit inside maxEdge, never up. An image already small enough
  // keeps its exact dimensions — re-encoding a 148×225 avatar at 600 would make
  // it bigger, not smaller.
  function targetSize(width, height, maxEdge) {
    var longest = Math.max(width, height);
    if (!longest || longest <= maxEdge) return { width: width, height: height, scaled: false };
    var ratio = maxEdge / longest;
    return {
      width: Math.max(1, Math.round(width * ratio)),
      height: Math.max(1, Math.round(height * ratio)),
      scaled: true
    };
  }

  // The centre square of a rectangle, and how big to draw it. Cropping rather
  // than squashing: a squashed portrait is a defect anyone can see, and letterbox
  // bars would put the activity's own background colour inside a grid of tiles
  // that already has one.
  //
  // Centre is the only defensible automatic choice. A face is usually near the
  // middle and never reliably at an edge, and the alternative is asking an admin
  // to pick a focal point, which is a bigger feature than this one.
  function squareCrop(width, height, maxEdge) {
    var side = Math.min(width, height);
    var out = Math.min(side, maxEdge);
    return {
      sx: Math.round((width - side) / 2),
      sy: Math.round((height - side) / 2),
      sSide: side,
      width: out,
      height: out,
      // Whether anything was actually cut away. A source that is already square
      // is not cropped, which is what makes it safe to hand the original back.
      cropped: width !== height,
      scaled: out < side
    };
  }

  // A canvas keeps one frame. Flattening someone's animated GIF into a still
  // and saying nothing would be a worse outcome than leaving it large, so
  // animated GIFs are passed through untouched.
  //
  // The marker is the Graphic Control Extension, 21 F9 04: one per frame. More
  // than one means more than one frame.
  function isAnimatedGif(bytes) {
    if (!bytes || bytes.length < 6) return false;
    var header = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (header !== 'GIF') return false;
    var frames = 0;
    for (var i = 0; i < bytes.length - 3; i++) {
      if (bytes[i] === 0x00 && bytes[i + 1] === 0x21 && bytes[i + 2] === 0xF9 && bytes[i + 3] === 0x04) {
        if (++frames > 1) return true;
      }
    }
    return false;
  }

  // JPEG cannot hold transparency, so anything transparent stays PNG — the same
  // split the site already makes between its photographs and its logos.
  function chooseType(sourceType, hasAlpha) {
    if (hasAlpha) return 'image/png';
    return 'image/jpeg';
  }

  // Formats a canvas must not touch: SVG is already small and resolution-free,
  // and rasterising it would be a downgrade.
  function isPassThrough(type, bytes) {
    if (type === 'image/svg+xml') return 'SVG is already resolution-free';
    if (isAnimatedGif(bytes)) return 'it is animated, and resizing would keep only the first frame';
    return null;
  }

  function hasTransparency(ctx, width, height) {
    var data;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch (err) {
      return true;   // can't tell — assume alpha, PNG is the safe answer
    }
    for (var i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  }

  function readBytes(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(new Uint8Array(r.result)); };
      r.onerror = function () { reject(r.error || new Error('Could not read the file')); };
      r.readAsArrayBuffer(file);
    });
  }

  function asDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error('Could not encode the image')); };
      r.readAsDataURL(blob);
    });
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        blob ? resolve(blob) : reject(new Error('The browser could not encode this image'));
      }, type, quality);
    });
  }

  function decode(file) {
    // imageOrientation:'from-image' matters more than it looks: a photo taken on
    // a phone carries its rotation in EXIF, and a canvas that ignores that draws
    // it on its side.
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return decodeViaImg(file);
      });
    }
    return decodeViaImg(file);
  }

  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read')); };
      img.src = url;
    });
  }

  /**
   * optimize(file, slot) -> { dataUrl, before, after, width, height, type, note }
   *
   * `slot` is 'hero' or 'credit'. Always resolves with something usable: if the
   * file cannot be improved, the original comes back with a note saying why.
   */
  function optimize(file, slot) {
    var profile = PROFILES[slot] || PROFILES.credit;

    return readBytes(file).then(function (bytes) {
      var skip = isPassThrough(file.type, bytes);
      if (skip) {
        return asDataUrl(file).then(function (dataUrl) {
          return { dataUrl: dataUrl, before: file.size, after: file.size,
                   type: file.type, note: 'left as it is — ' + skip };
        });
      }

      return decode(file).then(function (source) {
        var sw = source.width || source.naturalWidth;
        var sh = source.height || source.naturalHeight;
        var size = profile.square
          ? squareCrop(sw, sh, profile.maxEdge)
          : targetSize(sw, sh, profile.maxEdge);

        var canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        var ctx = canvas.getContext('2d');
        if (profile.square) {
          ctx.drawImage(source, size.sx, size.sy, size.sSide, size.sSide, 0, 0, size.width, size.height);
        } else {
          ctx.drawImage(source, 0, 0, size.width, size.height);
        }
        if (source.close) source.close();

        // JPEG never carries alpha, so there is nothing to check for one.
        var alpha = file.type === 'image/jpeg' ? false : hasTransparency(ctx, size.width, size.height);
        var type = chooseType(file.type, alpha);

        return toBlob(canvas, type, profile.quality).then(function (blob) {
          // Re-encoding does not always help. An already-well-compressed PNG or
          // GIF comes out LARGER — measured: a 52KB partner logo became 59KB, a
          // 30KB GIF became 32KB. Handing back the bigger file while reporting a
          // saving would be worse than doing nothing, so the original wins
          // whenever it is smaller.
          //
          // The exception is a picture whose dimensions are still wildly over
          // the target. Bytes are not the only cost: a 4000px image has to be
          // decoded into memory on a phone whatever it weighs on the wire.
          var muchTooBig = Math.max(sw, sh) > profile.maxEdge * 2;
          // Handing the original back is only safe when the canvas was not the
          // point. For a square slot it usually IS the point: a 1000×600 upload
          // that re-encodes larger must still come back cropped, or the one
          // promise this profile makes is broken by the size check. So the
          // bail-out is available only when nothing was cut away, which is to
          // say when the source was already square.
          var mustKeepCanvas = profile.square && size.cropped;
          if (blob.size >= file.size && !muchTooBig && !mustKeepCanvas) {
            return asDataUrl(file).then(function (dataUrl) {
              return { dataUrl: dataUrl, before: file.size, after: file.size, width: sw, height: sh,
                       type: file.type,
                       note: size.scaled ? 'kept as it is — re-encoding made it bigger' : 'already small enough' };
            });
          }
          return asDataUrl(blob).then(function (dataUrl) {
            var note;
            if (profile.square) {
              note = size.cropped
                ? 'cropped to a square ' + size.width + '×' + size.height
                : (size.scaled ? 'resized to ' + size.width + '×' + size.height : 're-encoded');
            } else {
              note = size.scaled ? 'resized to ' + size.width + '×' + size.height : 're-encoded';
            }
            return { dataUrl: dataUrl, before: file.size, after: blob.size,
                     width: size.width, height: size.height, type: type, note: note };
          });
        });
      });
    });
  }

  function describe(result) {
    var kb = function (n) { return Math.round(n / 1024) + ' KB'; };
    if (result.after >= result.before) return kb(result.before) + ' — ' + result.note;
    var saved = Math.round((1 - result.after / result.before) * 100);
    return kb(result.before) + ' → ' + kb(result.after) +
           ' (' + saved + '% smaller, ' + result.note + ')';
  }

  return {
    PROFILES: PROFILES,
    targetSize: targetSize,
    squareCrop: squareCrop,
    isAnimatedGif: isAnimatedGif,
    chooseType: chooseType,
    isPassThrough: isPassThrough,
    optimize: optimize,
    describe: describe
  };
});
