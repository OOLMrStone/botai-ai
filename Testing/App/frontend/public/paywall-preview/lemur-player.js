(() => {
  const players = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  function renderer(canvas) {
    const surface = document.createElement('canvas');
    surface.width = canvas.width;
    surface.height = canvas.height;
    const context = canvas.getContext('2d', { alpha: true });
    const gl = surface.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!context || !gl) return null;
    const program = gl.createProgram();
    for (const [kind, source] of [
      [
        gl.VERTEX_SHADER,
        'attribute vec2 p; varying vec2 uv; void main(){ uv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5); gl_Position=vec4(p,0.0,1.0); }',
      ],
      [
        gl.FRAGMENT_SHADER,
        'precision highp float; varying vec2 uv; uniform sampler2D frame; void main(){ vec3 rgb=texture2D(frame,vec2(uv.x,uv.y*0.5)).rgb; float a=texture2D(frame,vec2(uv.x,0.5+uv.y*0.5)).r; gl_FragColor=vec4(rgb*a,a); }',
      ],
    ]) {
      const shader = gl.createShader(kind);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
      gl.attachShader(program, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.viewport(0, 0, canvas.width, canvas.height);
    return {
      draw(video) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        // Safari получает обычный прозрачный 2D-слой, а не прямой WebGL-композит.
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(surface, 0, 0);
      },
      destroy() {
        gl.deleteTexture(texture);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      },
    };
  }

  function createPlayer(wrapper) {
    const poster = wrapper.querySelector('img');
    const video = wrapper.querySelector('video');
    const canvas = wrapper.querySelector('canvas');
    const output = renderer(canvas);
    if (!output) return { destroy() {} };
    const events = new AbortController();
    const options = { signal: events.signal };
    let visible = false;
    let disposed = false;
    let frame = null;
    let lastTime = -1;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    function stop() {
      video.pause();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    }
    function showPoster() {
      canvas.hidden = true;
      poster.hidden = false;
    }
    function tick() {
      frame = null;
      if (disposed || !visible || document.hidden || reducedMotion.matches) return;
      if (video.readyState >= 2 && video.currentTime !== lastTime) {
        output.draw(video);
        lastTime = video.currentTime;
        canvas.hidden = false;
        poster.hidden = true;
      }
      frame = requestAnimationFrame(tick);
    }
    function refresh() {
      stop();
      if (disposed) return;
      if (reducedMotion.matches) showPoster();
      else if (visible && !document.hidden) {
        video
          .play()
          .then(() => {
            if (!disposed && visible && !document.hidden && frame === null) tick();
          })
          .catch(showPoster);
      }
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    observer.observe(wrapper);
    document.addEventListener('visibilitychange', refresh, options);
    reducedMotion.addEventListener('change', refresh, options);
    // Если iOS блокирует autoplay, пользовательский жест повторяет запуск.
    document.addEventListener(
      'touchend',
      () => {
        if (video.paused) refresh();
      },
      options,
    );
    video.addEventListener(
      'error',
      () => {
        stop();
        showPoster();
      },
      options,
    );
    return {
      destroy() {
        disposed = true;
        stop();
        observer.disconnect();
        events.abort();
        output.destroy();
      },
    };
  }
  function removeDetached() {
    for (const [wrapper, player] of players) {
      if (!wrapper.isConnected) {
        player.destroy();
        players.delete(wrapper);
      }
    }
  }
  window.syncPaywallLemur = () => {
    removeDetached();
    document.querySelectorAll('[data-lemur]').forEach((wrapper) => {
      if (!players.has(wrapper)) players.set(wrapper, createPlayer(wrapper));
    });
  };
  new MutationObserver(removeDetached).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
