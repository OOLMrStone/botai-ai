export const EMBEDDED_BO = {
  // Сфера пока отключена: стартовый экран оставляем лёгким и спокойным.
  welcomeSphereEnabled: false,
  visibilityThreshold: 0,
  alpha: {
    width: 1080,
    height: 1080,
    vertexShader:
      'attribute vec2 p; varying vec2 uv; void main(){ uv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5); gl_Position=vec4(p,0.0,1.0); }',
    fragmentShader:
      'precision highp float; varying vec2 uv; uniform sampler2D frame; void main(){ vec3 rgb=texture2D(frame,vec2(uv.x,uv.y*0.5)).rgb; float a=texture2D(frame,vec2(uv.x,0.5+uv.y*0.5)).r; gl_FragColor=vec4(rgb*a,a); }',
    vertices: [-1, -1, 1, -1, -1, 1, 1, 1],
    positionSize: 2,
    vertexCount: 4,
  },
} as const;

export const EMBEDDED_BO_COPY = {
  start: 'Оживить Бо',
} as const;
