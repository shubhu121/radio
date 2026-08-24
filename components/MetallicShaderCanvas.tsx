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
uniform vec2 u_dialCenter; // normalized dial center (490/720, 245/490)

// Fast hash
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// 2D Value Noise
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

// High-fidelity brushed titanium/aluminum micro-grooves
float shinyMetalGrain(vec2 uv) {
  float h1 = fract(sin(uv.y * 1400.0) * 43758.5453);
  float h2 = fract(sin(uv.y * 700.0 + 1.2) * 23421.6312);
  float h3 = fract(sin(uv.y * 350.0 + 4.5) * 17492.1245);
  float n = noise(uv * vec2(16.0, 600.0));
  return h1 * 0.40 + h2 * 0.30 + h3 * 0.15 + n * 0.15;
}

// Sandblasted micro-roughness for dark matte center
float matteSandblastGrain(vec2 uv) {
  float speckle = fract(sin(dot(uv * 520.0, vec2(12.9898, 78.233))) * 43758.5453);
  float n = noise(uv * 180.0);
  return speckle * 0.65 + n * 0.35;
}

void main() {
  vec2 uv = v_uv;
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  
  // Interactive light position with natural resting sweep
  vec2 mouse = u_mouse;
  if (mouse.x <= 0.0 && mouse.y <= 0.0) {
    mouse = vec2(
      0.30 + sin(u_time * 0.45) * 0.28,
      0.22 + cos(u_time * 0.35) * 0.18
    );
  }
  
  vec2 center = u_dialCenter;
  vec2 toDial = (uv - center) * aspect;
  float distToDial = length(toDial);
  
  // Dial radius in normalized height coordinates (~268px on 490px height => 268.0 / 490.0 = ~0.5469)
  float dialRadius = 268.0 / 490.0;
  
  // 0.0 = Outer Shiny Metal Chassis, 1.0 = Inner Matte Black Dial Component
  float isInnerDial = smoothstep(dialRadius + 0.005, dialRadius - 0.005, distToDial);
  
  // Light calculations
  vec2 lightDir = (mouse - uv) * aspect;
  float lightDist = length(lightDir);
  vec3 L = normalize(vec3(lightDir, 0.60));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 H = normalize(L + V);
  
  // -------------------------------------------------------------
  // 1. SHINY ENGRAVED METALLIC SHADER (Outer Chassis & Beveled Frame)
  // -------------------------------------------------------------
  float outerGrain = shinyMetalGrain(uv);
  
  // Highly reflective silver-lavender titanium palette
  vec3 metalDeep = vec3(0.42, 0.39, 0.52);
  vec3 metalMid = vec3(0.74, 0.71, 0.84);
  vec3 metalBright = vec3(0.95, 0.93, 0.99);
  vec3 pureWhite = vec3(1.0, 1.0, 1.0);
  
  // Primary horizontal anisotropic brush reflection cone (Kajiya-Kay model)
  vec2 tangent = vec2(1.0, 0.0);
  float TdotH = dot(vec3(tangent, 0.0), H);
  float sinTH = sqrt(max(0.0, 1.0 - TdotH * TdotH));
  float anisoBand1 = pow(sinTH, 18.0);
  float anisoBand2 = pow(sinTH, 4.0) * 0.4;
  
  // Radial lathe brush highlight radiating across the corner contours
  vec2 radTangent = normalize(vec2(-toDial.y, toDial.x));
  float RadTdotH = dot(vec3(radTangent, 0.0), H);
  float radialAniso = pow(sqrt(max(0.0, 1.0 - RadTdotH * RadTdotH)), 12.0) * 0.35;
  
  // Direct specular hotspot
  float directSpec = pow(max(0.0, dot(vec3(0.0, 0.0, 1.0), H)), 32.0);
  
  // Diffuse light gradient
  float diffuse = max(0.0, dot(vec3(0.0, 0.0, 1.0), L)) * 0.5 + 0.5;
  
  // Sweeping diagonal metallic light sheen
  float diagSheen = pow(max(0.0, 1.0 - abs((uv.x + uv.y * 0.7) - (mouse.x + mouse.y * 0.7))), 6.0) * 0.55;
  
  vec3 shinyColor = mix(metalDeep, metalMid, diffuse);
  shinyColor += metalBright * ((anisoBand1 + anisoBand2 + radialAniso) * 0.65 * exp(-lightDist * 0.6));
  shinyColor += pureWhite * (directSpec * 0.50 * exp(-lightDist * 0.4) + diagSheen * 0.40);
  shinyColor += (outerGrain - 0.5) * 0.09;
  
  // Machined Outer Perimeter Chamfer (Catching brilliant top-left highlight)
  float edgeDistX = min(uv.x, 1.0 - uv.x) * aspect.x;
  float edgeDistY = min(uv.y, 1.0 - uv.y);
  float edgeDist = min(edgeDistX, edgeDistY);
  float edgeBevel = smoothstep(0.024, 0.002, edgeDist);
  float topHighlight = smoothstep(0.020, 0.001, uv.y) * 0.75;
  float leftHighlight = smoothstep(0.020, 0.001, uv.x) * 0.55;
  shinyColor += pureWhite * (edgeBevel * 0.65 + topHighlight + leftHighlight);
  
  // -------------------------------------------------------------
  // 2. MATTE BLACK SHADER (Inner Circular Dial)
  // -------------------------------------------------------------
  float matteGrain = matteSandblastGrain(uv);
  
  // Deep velvety anodized black-graphite tones
  vec3 matteDeepBlack = vec3(0.035, 0.022, 0.060);
  vec3 matteMidGraphite = vec3(0.075, 0.052, 0.115);
  vec3 matteSoftSheen = vec3(0.140, 0.105, 0.195);
  
  // Soft diffuse micro-scattering (zero glare)
  float matteDiff = max(0.0, dot(vec3(0.0, 0.0, 1.0), L)) * 0.35 + 0.65;
  float matteSheenFactor = pow(max(0.0, dot(vec3(0.0, 0.0, 1.0), H)), 4.0) * 0.10 * exp(-lightDist * 1.5);
  
  vec3 matteColor = mix(matteDeepBlack, matteMidGraphite, matteDiff);
  matteColor += matteSoftSheen * (matteSheenFactor + u_isDragging * 0.04);
  matteColor += (matteGrain - 0.5) * 0.035;
  
  // Radial depth gradient within dial cavity
  float normDialDist = distToDial / dialRadius;
  matteColor *= mix(0.86, 1.04, normDialDist);
  
  // -------------------------------------------------------------
  // 3. RECESS BOUNDARY (Milled Step Groove between Shiny & Matte)
  // -------------------------------------------------------------
  float jointDist = abs(distToDial - dialRadius);
  float jointShadow = smoothstep(0.006, 0.000, jointDist) * 0.5;
  float jointHighlight = smoothstep(0.012, 0.005, distToDial - dialRadius) * smoothstep(0.018, 0.012, dialRadius + 0.018 - distToDial) * 0.45;
  
  // Combine the two distinct shader materials
  vec3 finalColor = mix(shinyColor, matteColor, isInnerDial);
  
  // Shadow and bright milled lip
  finalColor = mix(finalColor, vec3(0.01, 0.005, 0.02), jointShadow * isInnerDial);
  finalColor += pureWhite * jointHighlight * (1.0 - isInnerDial);
  
  // Soft corner vignette
  float vig = length((uv - vec2(0.5)) * aspect);
  finalColor *= (1.0 - vig * 0.10);
  
  gl_FragColor = vec4(finalColor, 1.0);
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
      return;
    }

    const createShader = (type: number, src: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
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
      return;
    }

    gl.useProgram(program);

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

    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    const uMouse = gl.getUniformLocation(program, 'u_mouse');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uIsDragging = gl.getUniformLocation(program, 'u_isDragging');
    const uDialCenter = gl.getUniformLocation(program, 'u_dialCenter');

    const startTime = performance.now();

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
