export interface FoliageWind {
  strength: number;
  speed: number;
  turbulence: number;
  direction: number;
}

export const FOLIAGE_WIND_PRESETS = {
  Still: { strength: 0, speed: 1, turbulence: 0, direction: 1 },
  Breeze: { strength: 2, speed: 1, turbulence: 0.3, direction: 1 },
  Gusts: { strength: 4, speed: 1.4, turbulence: 0.8, direction: 1 },
} satisfies Record<string, FoliageWind>;

const vertex = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

const fragment = `
precision highp float;
uniform sampler2D uSprite;
uniform vec2 uSize;
uniform float uTime;
uniform float uStrength;
uniform float uSpeed;
uniform float uTurbulence;
uniform float uDirection;
uniform float uPhase;
uniform float uAnchor;
uniform float uHeight;
uniform float uResponse;
uniform float uSwayRate;
uniform float uFlutter;
void main() {
  vec2 pixel = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  float height = clamp((uAnchor - pixel.y) / uHeight, 0.0, 1.0);
  float bend = height * height;
  float t = uTime * uSpeed;
  float wave = sin(t * 2.2 * uSwayRate + uPhase - height * 1.8);
  float gust = pow(0.5 + 0.5 * sin(t * 0.73 + uPhase), 3.0);
  float flutter = sin(t * 7.1 - height * 5.0 + uPhase);
  flutter += uFlutter * sin(pixel.x * 0.8 + height * 12.0 - t * 5.0);
  float wind = 0.35 + wave * 0.65 + uTurbulence * (gust * 1.6 + flutter * 0.22);
  float shift = floor(uDirection * uStrength * uResponse * bend * wind + 0.5);
  vec2 source = vec2(pixel.x - shift, pixel.y);
  if (source.x < 0.0 || source.x >= uSize.x) {
    gl_FragColor = vec4(0.0);
  } else {
    gl_FragColor = texture2D(uSprite, source / uSize);
  }
}
`;

export interface FoliageWindProfile {
  anchor: number;
  height: number;
  response: number;
  swayRate: number;
  flutter: number;
}

export class FoliageWindRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly buffer: WebGLBuffer;
  private readonly uniforms: Record<string, WebGLUniformLocation> = {};
  private phase = 0;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    onError: (cause: unknown) => void,
    signal: AbortSignal,
    private readonly profile: FoliageWindProfile,
  ) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('Foliage wind needs WebGL. Enable hardware acceleration and reload.');
    this.gl = gl;
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    try {
      if (!program || !buffer || !texture) throw new Error('Could not allocate the foliage wind shader.');
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(Number(type));
        if (!shader) throw new Error('Could not create the foliage wind shader.');
        shaders.push(shader);
        gl.shaderSource(shader, String(source));
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`Foliage shader: ${gl.getShaderInfoLog(shader)}`);
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Foliage shader: ${gl.getProgramInfoLog(program)}`);
      this.program = program;
      this.buffer = buffer;
      this.texture = texture;
      gl.useProgram(program);
      for (const name of ['uSprite', 'uSize', 'uTime', 'uStrength', 'uSpeed', 'uTurbulence', 'uDirection', 'uPhase', 'uAnchor', 'uHeight', 'uResponse', 'uSwayRate', 'uFlutter']) {
        const location = gl.getUniformLocation(program, name);
        if (location === null) throw new Error(`Foliage shader uniform is missing: ${name}`);
        this.uniforms[name] = location;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'aPosition');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        onError(new Error('Foliage wind lost its WebGL context. Reload to restore the preview.'));
      }, { signal });
    } catch (cause) {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      throw cause;
    } finally {
      shaders.forEach(shader => gl.deleteShader(shader));
    }
  }

  setSprite(source: HTMLCanvasElement, seed: number): void {
    this.phase = (seed % 997) / 997 * Math.PI * 2;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  draw(seconds: number, wind: FoliageWind): void {
    if (this.disposed || this.gl.isContextLost()) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.uniforms.uSprite, 0);
    gl.uniform2f(this.uniforms.uSize, this.canvas.width, this.canvas.height);
    for (const [name, value] of Object.entries({
      uTime: seconds, uStrength: wind.strength, uSpeed: wind.speed,
      uTurbulence: wind.turbulence, uDirection: wind.direction, uPhase: this.phase,
      uAnchor: this.profile.anchor, uHeight: this.profile.height,
      uResponse: this.profile.response, uSwayRate: this.profile.swayRate, uFlutter: this.profile.flutter,
    })) gl.uniform1f(this.uniforms[name], value);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.deleteTexture(this.texture);
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
