import { EMBEDDED_BO } from '@/config/embedded-bo';

// Цвет и маска взяты из одного кадра, поэтому края не отстают от движения.
export function createLemurAlphaRenderer(canvas: HTMLCanvasElement) {
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
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!program || !buffer || !texture) return null;

  function destroy() {
    if (!gl) return;
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  const shaders = [
    [gl.VERTEX_SHADER, EMBEDDED_BO.alpha.vertexShader],
    [gl.FRAGMENT_SHADER, EMBEDDED_BO.alpha.fragmentShader],
  ] as const;
  for (const [kind, source] of shaders) {
    const shader = gl.createShader(kind);
    if (!shader) {
      destroy();
      return null;
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      destroy();
      return null;
    }
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    destroy();
    return null;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(EMBEDDED_BO.alpha.vertices), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, EMBEDDED_BO.alpha.positionSize, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.viewport(0, 0, canvas.width, canvas.height);

  return {
    draw(video: HTMLVideoElement) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, EMBEDDED_BO.alpha.vertexCount);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(surface, 0, 0);
    },
    destroy,
  };
}
