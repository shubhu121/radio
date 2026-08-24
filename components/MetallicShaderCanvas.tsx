'use client';

import React, { useEffect, useRef } from 'react';

interface MetallicShaderCanvasProps {
  className?: string;
  isDragging?: boolean;
}

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = (a_position + 1.0) * 0.5;
  // Flip Y so 0,0 is top-left
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_time;
uniform float u_isDragging;
uniform vec2 u_dialCenter; // normalized dial center

// Hash function for procedural noise
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// 1D Perlin-like noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Procedural brushed anisotropic grain
float brushedGrain(vec2 uv, vec2 center) {
  vec2 d = uv - center;
  float angle = atan(d.y, d.x);
  float dist = length(d);
  
  // Radial brushed streaks centered around dial
  float radialStreak = sin(angle * 160.0 + noise(vec2(angle * 30.0, dist * 5.0)) * 4.0) * 0.5 + 0.5;
  
  // Horizontal micro-brushing across the titanium plate
  float horizontalGrain = fract(sin(dot(uv * vec2(12.0, 850.0), vec2(12.9898, 78.233))) * 43758.5453);
  
  return mix(radialStreak * 0.6 + 0.4, horizontalGrain, 0.35);
}

void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  
  // Mouse position normalized
  vec2 mouse = u_mouse;
  if (mouse.x <= 0.0 && mouse.y <= 0.0) {
    // Ambient floating light if no interaction
    mouse = vec2(
      0.5 + sin(u_time * 0.7) * 0.35,
      0.45 + cos(u_time * 0.5) * 0.25
    );
  }
  
  // Base dark gunmetal / titanium metallic palette
  vec3 metalBase = vec3(0.08, 0.075, 0.10);     // Deep obsidian titanium
  vec3 metalMid  = vec3(0.16, 0.15, 0.20);     // Anodized slate steel
  vec3 metalHigh = vec3(0.38, 0.35, 0.46);     // Brushed silver-violet sheen
  vec3 metalHot  = vec3(0.85, 0.82, 0.95);     // Sharp chrome specular reflection
  
  // Micro-texture grain
  float grain = brushedGrain(uv, u_dialCenter);
  
  // Primary light vector from mouse cursor
  vec2 lightDir = (mouse - uv) * aspect;
  float lightDist = length(lightDir);
  vec3 L = normalize(vec3(lightDir, 0.42));
  
  // Secondary ambient studio rim light (top-left)
  vec3 L2 = normalize(vec3((vec2(0.1, 0.05) - uv) * aspect, 0.6));
  
  // Surface normal with subtle brushed micro-grooves
  float bump = (grain - 0.5) * 0.06;
  vec3 N = normalize(vec3(bump * 1.5, bump, 1.0));
  
  // Anisotropic tangent vector (rotary around dial center)
  vec2 tangent2D = normalize(vec2(-(uv.y - u_dialCenter.y), uv.x - u_dialCenter.x));
  vec3 T = normalize(vec3(tangent2D, 0.0));
  
  // Anisotropic Ward/Kajiya-Kay specular approximation for brushed metal
  float dotLT = dot(L, T);
  float dotVR = dot(vec3(0.0, 0.0, 1.0), T); // View is straight on
  float sinLT = sqrt(max(0.0, 1.0 - dotLT * dotLT));
  float sinVT = sqrt(max(0.0, 1.0 - dotVR * dotVR));
  float anisoSpec = max(0.0, dotLT * dotVR + sinLT * sinVT);
  anisoSpec = pow(anisoSpec, 32.0) * (0.8 + 0.4 * grain);
  
  // Secondary standard Blinn-Phong specular highlight
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float NdotH = max(0.0, dot(N, H));
  float sharpSpec = pow(NdotH, 64.0) * 1.8;
  
  // Diffuse falloff from moving light
  float diff = max(0.0, dot(N, L)) * exp(-lightDist * 1.8);
  float diff2 = max(0.0, dot(N, L2)) * 0.4;
  
  // Radial reflection cone (signature of metallic rotary knobs & dials)
  float angleToCenter = atan(uv.y - u_dialCenter.y, uv.x - u_dialCenter.x);
  float coneReflection = pow(abs(cos(angleToCenter * 2.0 + u_time * 0.08)), 16.0) * 0.45;
  coneReflection += pow(abs(cos(angleToCenter * 4.0 - 0.5)), 32.0) * 0.3;
  
  // Chamfer / Edge bevel highlights (beveled machined metal plate rim)
  float edgeDistX = min(uv.x, 1.0 - uv.x) * aspect.x;
  float edgeDistY = min(uv.y, 1.0 - uv.y);
  float edgeDist = min(edgeDistX, edgeDistY);
  float bevelLight = smoothstep(0.02, 0.001, edgeDist);
  float topHighlight = smoothstep(0.015, 0.001, uv.y) * max(0.0, dot(L2, vec3(0.0, -1.0, 0.5))) * 1.2;
  
  // Dragging interaction boost (plate becomes more reactive and luminescent when tuned)
  float dragBoost = u_isDragging * 0.25;
  
  // Compose metallic layers
  vec3 color = metalBase;
  color += metalMid * (diff + diff2 + coneReflection);
  color += metalHigh * (anisoSpec * 1.2 + grain * 0.08 + dragBoost);
  color += metalHot * (sharpSpec * 1.4 * exp(-lightDist * 2.2));
  
  // Add chamfer bevel edge glint
  color += metalHigh * bevelLight * 0.8;
  color += vec3(0.9, 0.88, 1.0) * topHighlight;
  
  // Subtle radial vignette towards corners
  float cornerDist = length((uv - vec2(0.5)) * aspect);
  color *= (1.05 - cornerDist * 0.35);
  
  // Contrast curve for deep metallic punch
  color = pow(color, vec3(0.95));
  
  gl_FragColor = vec4(color, 1.0);
}
`;

export default function MetallicShaderCanvas({ className, isDragging = false }: MetallicShaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      console.warn('WebGL not supported, fallback to CSS metal.');
      return;
    }

    // Compile shaders
    const createShader = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertShader = createShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragShader = createShader(gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    if (!vertShader || !fragShader) return;

    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program));
      return;
    }

    gl.useProgram(program);

    // Full screen quad
    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uMouse = gl.getUniformLocation(program, 'u_mouse');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uIsDragging = gl.getUniformLocation(program, 'u_isDragging');
    const uDialCenter = gl.getUniformLocation(program, 'u_dialCenter');

    let startTime = performance.now();

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      mousePosRef.current = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
    };

    const handleMouseLeave = () => {
      mousePosRef.current = { x: -1, y: -1 };
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.touches[0].clientX - rect.left) / rect.width;
        const y = (e.touches[0].clientY - rect.top) / rect.height;
        mousePosRef.current = { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('touchmove', handleTouchMove);

    const render = () => {
      if (!canvas) return;

      // Handle retina displays
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const displayWidth = Math.round(canvas.clientWidth * dpr);
      const displayHeight = Math.round(canvas.clientHeight * dpr);

      if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      const elapsed = (performance.now() - startTime) * 0.001;

      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform2f(uMouse, mousePosRef.current.x, mousePosRef.current.y);
      gl.uniform1f(uTime, elapsed);
      gl.uniform1f(uIsDragging, isDragging ? 1.0 : 0.0);
      // Normalized coordinates of dial center (cx=490 / 720, cy=245 / 490 = 0.5)
      gl.uniform2f(uDialCenter, 490 / 720, 245 / 490);

      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('touchmove', handleTouchMove);
      gl.deleteProgram(program);
      gl.deleteShader(vertShader);
      gl.deleteShader(fragShader);
      gl.deleteBuffer(posBuffer);
    };
  }, [isDragging]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 w-full h-full pointer-events-none rounded-[34px] ${className || ''}`}
      style={{ display: 'block' }}
    />
  );
}
