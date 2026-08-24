'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { radioEngine } from '@/lib/audio-player';
import { FM_SCALE_PRESETS, AM_SCALE_PRESETS, Station } from '@/lib/radio-engine';
import MetallicShaderCanvas from '@/components/MetallicShaderCanvas';

// Helper to avoid SSR floating point serialization mismatch
const roundCoord = (val: number) => Math.round(val * 100) / 100;

export default function RadioApp() {
  const [band, setBand] = useState<'FM' | 'AM'>('FM');
  const [frequency, setFrequency] = useState<number>(98.8);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordSeconds, setRecordSeconds] = useState<number>(0);
  const [activeStation, setActiveStation] = useState<Station | null>(null);
  const [signalStrength, setSignalStrength] = useState<number>(0);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>('14:10');
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const dragStartYRef = useRef<number>(0);
  const dragStartAngleRef = useRef<number>(0);
  const startFreqRef = useRef<number>(98.8);
  const lastTickFreqRef = useRef<number>(98.8);

  // Live system clock updater
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      setCurrentTimeStr(`${hours}:${mins}`);
    };
    updateTime();
    const timer = setInterval(updateTime, 10000);
    return () => clearInterval(timer);
  }, []);

  // Recording timer
  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setRecordSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRecording]);

  // Audio Engine Synchronization
  const updateTuning = useCallback((newFreq: number, currentBand: 'FM' | 'AM', playing: boolean) => {
    const result = radioEngine.tune(newFreq, currentBand, playing);
    setActiveStation(result.station);
    setSignalStrength(result.signalStrength);
  }, []);

  const handleFrequencyChange = useCallback((newFreq: number, userBand: 'FM' | 'AM' = band) => {
    const minF = userBand === 'FM' ? 87.5 : 530;
    const maxF = userBand === 'FM' ? 108.0 : 1700;
    
    // Clamp
    let clamped = Math.max(minF, Math.min(maxF, newFreq));
    if (userBand === 'FM') {
      clamped = Math.round(clamped * 10) / 10;
    } else {
      clamped = Math.round(clamped / 10) * 10;
    }

    setFrequency(clamped);

    // Audio tick on discrete movement
    const tickStep = userBand === 'FM' ? 0.2 : 20;
    if (Math.abs(clamped - lastTickFreqRef.current) >= tickStep) {
      radioEngine.playTickSound();
      lastTickFreqRef.current = clamped;
    }

    updateTuning(clamped, userBand, isPlaying);
  }, [band, isPlaying, updateTuning]);

  const toggleBand = (newBand: 'FM' | 'AM') => {
    if (newBand === band) return;
    setBand(newBand);
    radioEngine.playTickSound();
    const defaultFreq = newBand === 'FM' ? 98.8 : 880;
    setFrequency(defaultFreq);
    lastTickFreqRef.current = defaultFreq;
    updateTuning(defaultFreq, newBand, isPlaying);
  };

  const togglePower = useCallback(() => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    radioEngine.playTickSound();
    updateTuning(frequency, band, nextState);
  }, [isPlaying, frequency, band, updateTuning]);

  const toggleRecording = async () => {
    if (!isRecording) {
      const ok = await radioEngine.startRecording();
      if (ok) {
        setRecordSeconds(0);
        setIsRecording(true);
      }
    } else {
      setIsRecording(false);
      const blob = radioEngine.stopRecording();
      if (blob) {
        // Download recording
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `radio-record-${band}-${frequency}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }
  };

  // Keyboard navigation for precision tuning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = band === 'FM' ? 0.1 : 10;
        handleFrequencyChange(frequency + step);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const step = band === 'FM' ? 0.1 : 10;
        handleFrequencyChange(frequency - step);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        togglePower();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [frequency, band, handleFrequencyChange, togglePower]);

  // Mouse Wheel tuning with smooth stepping
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    const step = band === 'FM' ? 0.1 * delta : 10 * delta;
    handleFrequencyChange(frequency + step);
  };

  // Geometry configuration matching the reference layout
  const cx = 490;
  const cy = 245;
  const rBandOuter = 338;
  const rBandInner = 292;
  const rInnerTicks = 265;
  const rOuterTicks = 385;

  // Scale presets for the band
  const presets = band === 'FM' ? FM_SCALE_PRESETS : AM_SCALE_PRESETS;
  const baseFreq = band === 'FM' ? 98.8 : 880;
  const degMultiplier = band === 'FM' ? 5.2 : 0.08;

  // Compute rotation angle for the rotary tick drum
  const dialRotation = (frequency - baseFreq) * -degMultiplier;

  // Calculate angle for any frequency along the rotary circle
  const getAngleForFreq = useCallback((f: number) => {
    const defaultAngle = 180 + (f - 98.8) * 5.4;
    return defaultAngle + dialRotation;
  }, [dialRotation]);

  // Dragging interaction supporting both angular rotary grab and vertical gesture
  const getEventCardCoords = (clientX: number, clientY: number) => {
    if (!cardRef.current) return { x: 0, y: 0 };
    const rect = cardRef.current.getBoundingClientRect();
    const scaleX = 720 / rect.width;
    const scaleY = 490 / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartYRef.current = e.clientY;
    startFreqRef.current = frequency;

    const { x, y } = getEventCardCoords(e.clientX, e.clientY);
    const angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI);
    dragStartAngleRef.current = angle;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      setIsDragging(true);
      dragStartYRef.current = e.touches[0].clientY;
      startFreqRef.current = frequency;

      const { x, y } = getEventCardCoords(e.touches[0].clientX, e.touches[0].clientY);
      const angle = Math.atan2(y - cy, x - cx) * (180 / Math.PI);
      dragStartAngleRef.current = angle;
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const { x, y } = getEventCardCoords(e.clientX, e.clientY);
      if (x < 550) {
        const currentAngle = Math.atan2(y - cy, x - cx) * (180 / Math.PI);
        let angleDelta = currentAngle - dragStartAngleRef.current;
        if (angleDelta > 180) angleDelta -= 360;
        if (angleDelta < -180) angleDelta += 360;

        const freqDelta = -angleDelta / degMultiplier;
        handleFrequencyChange(startFreqRef.current + freqDelta);
      } else {
        const dy = dragStartYRef.current - e.clientY;
        const sensitivity = band === 'FM' ? 0.04 : 4;
        handleFrequencyChange(startFreqRef.current + dy * sensitivity);
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length === 0) return;
      const { x, y } = getEventCardCoords(e.touches[0].clientX, e.touches[0].clientY);
      if (x < 550) {
        const currentAngle = Math.atan2(y - cy, x - cx) * (180 / Math.PI);
        let angleDelta = currentAngle - dragStartAngleRef.current;
        if (angleDelta > 180) angleDelta -= 360;
        if (angleDelta < -180) angleDelta += 360;

        const freqDelta = -angleDelta / degMultiplier;
        handleFrequencyChange(startFreqRef.current + freqDelta);
      } else {
        const dy = dragStartYRef.current - e.touches[0].clientY;
        const sensitivity = band === 'FM' ? 0.04 : 4;
        handleFrequencyChange(startFreqRef.current + dy * sensitivity);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging, band, degMultiplier, handleFrequencyChange]);

  // Format frequency for display: 098.8 / 104.5 or 0880
  const formattedFrequency = band === 'FM'
    ? frequency.toFixed(1).padStart(5, '0')
    : Math.round(frequency).toString().padStart(4, '0');

  // Format recording timer: 00:15
  const formattedRecTime = `${String(Math.floor(recordSeconds / 60)).padStart(2, '0')}:${String(recordSeconds % 60).padStart(2, '0')}`;

  // Memoize full 360° radial ticks around the rotary dial wheel with engraved highlights & shadows
  const radialTicks = useMemo(() => {
    const ticks = [];
    const totalTicks = 96;
    for (let i = 0; i < totalTicks; i++) {
      const deg = (i / totalTicks) * 360;
      const rad = (deg * Math.PI) / 180;

      const isMajor = i % 4 === 0;
      const isMedium = i % 2 === 0;
      const tickLength = isMajor ? 26 : isMedium ? 16 : 10;
      const r1 = rInnerTicks;
      const r2 = rInnerTicks - tickLength;

      const x1 = roundCoord(cx + r1 * Math.cos(rad));
      const y1 = roundCoord(cy + r1 * Math.sin(rad));
      const x2 = roundCoord(cx + r2 * Math.cos(rad));
      const y2 = roundCoord(cy + r2 * Math.sin(rad));

      // Normal vector for engraved highlight offset
      const nx = -Math.sin(rad) * 0.75;
      const ny = Math.cos(rad) * 0.75;

      ticks.push({
        id: `in-${i}`,
        x1,
        y1,
        x2,
        y2,
        // Specular engraved bevel offset
        hx1: roundCoord(x1 + nx),
        hy1: roundCoord(y1 + ny),
        hx2: roundCoord(x2 + nx),
        hy2: roundCoord(y2 + ny),
        // Inset shadow offset
        sx1: roundCoord(x1 - nx),
        sy1: roundCoord(y1 - ny),
        sx2: roundCoord(x2 - nx),
        sy2: roundCoord(y2 - ny),
        isMajor,
        isMedium,
      });
    }
    return ticks;
  }, []);

  // Memoize outer ticks
  const outerTicks = useMemo(() => {
    const ticks = [];
    const totalTicks = 80;
    for (let i = 0; i < totalTicks; i++) {
      const deg = (i / totalTicks) * 360;
      const rad = (deg * Math.PI) / 180;
      const r1 = rOuterTicks;
      const r2 = rOuterTicks + 18;

      const x1 = roundCoord(cx + r1 * Math.cos(rad));
      const y1 = roundCoord(cy + r1 * Math.sin(rad));
      const x2 = roundCoord(cx + r2 * Math.cos(rad));
      const y2 = roundCoord(cy + r2 * Math.sin(rad));

      const nx = -Math.sin(rad) * 0.6;
      const ny = Math.cos(rad) * 0.6;

      ticks.push({
        id: `out-${i}`,
        x1,
        y1,
        x2,
        y2,
        hx1: roundCoord(x1 + nx),
        hy1: roundCoord(y1 + ny),
        hx2: roundCoord(x2 + nx),
        hy2: roundCoord(y2 + ny),
      });
    }
    return ticks;
  }, []);

  return (
    <main
      id="radio-tuner-main"
      className="min-h-screen w-full flex items-center justify-center p-3 sm:p-6 select-none bg-[#BFAAE8] overflow-hidden"
      style={{
        background: 'radial-gradient(circle at 50% 30%, #D8CAFA 0%, #BAA2EC 60%, #9C80DE 100%)',
      }}
    >
      {/* Central Skeuomorphic Matte Anodized Dark Metal Chassis */}
      <div
        id="radio-card"
        ref={cardRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className={`relative w-full max-w-[720px] aspect-[720/490] rounded-[34px] text-white overflow-hidden shadow-2xl transition-transform border border-white/15 ${
          isDragging ? 'cursor-grabbing scale-[0.998]' : 'cursor-grab active:scale-[0.998]'
        }`}
        style={{
          boxShadow: `
            0 35px 80px -15px rgba(35, 15, 70, 0.6),
            0 18px 36px -5px rgba(0, 0, 0, 0.75),
            inset 0 1.5px 0.5px rgba(255, 255, 255, 0.35),
            inset 0 -2px 3px rgba(0, 0, 0, 0.8),
            0 0 0 1px rgba(25, 18, 40, 0.9)
          `,
          background: '#0B0714',
        }}
      >
        {/* Custom WebGL Matte Finish Anodized Metal Shader Canvas */}
        <MetallicShaderCanvas isDragging={isDragging} />

        {/* Ambient Subtle Matte Top Bevel Overlay */}
        <div
          className="absolute inset-0 pointer-events-none rounded-[34px]"
          style={{
            background: `
              linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, transparent 40%, rgba(0, 0, 0, 0.25) 100%),
              radial-gradient(ellipse at 75% 20%, rgba(200, 180, 250, 0.07) 0%, transparent 60%)
            `,
          }}
        />

        {/* Precision Matte Bead-Blasted Stainless Steel Corner Screws */}
        {[
          { id: 'screw-tl', className: 'top-4 left-4' },
          { id: 'screw-tr', className: 'top-4 right-4' },
          { id: 'screw-bl', className: 'bottom-4 left-4' },
          { id: 'screw-br', className: 'bottom-4 right-4' },
        ].map((screw) => (
          <div
            key={screw.id}
            id={screw.id}
            className={`absolute ${screw.className} w-3.5 h-3.5 rounded-full pointer-events-none shadow-md flex items-center justify-center`}
            style={{
              background: 'radial-gradient(circle at 35% 35%, #B8B0D0 0%, #685E82 60%, #201A30 100%)',
              boxShadow: 'inset 0 1px 1px rgba(255, 255, 255, 0.45), 0 1px 2px rgba(0, 0, 0, 0.8), inset 0 -1px 1px rgba(0, 0, 0, 0.8)',
            }}
          >
            {/* Screw Slot Groove */}
            <div
              className="w-2 h-0.5 bg-[#140E22] rounded-full shadow-[0_0.8px_0_rgba(255,255,255,0.25)] transform rotate-45"
            />
          </div>
        ))}

        {/* SVG Graphic Layer for Dial, Engraved Ticks, Anodized Band, and Needle */}
        <svg
          viewBox="0 0 720 490"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          <defs>
            {/* Matte Satin Violet Anodized Metal Gradient for the Circular Band */}
            <linearGradient id="anodizedBandGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3F1B85" />
              <stop offset="25%" stopColor="#6C3ECE" />
              <stop offset="50%" stopColor="#C8B4F5" />
              <stop offset="75%" stopColor="#6133BC" />
              <stop offset="100%" stopColor="#2E0E68" />
            </linearGradient>

            {/* Needle Glow Filter */}
            <filter id="purpleGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Outer Tick Marks - Engraved Groove with Highlight */}
          <g
            id="outer-ticks-drum"
            style={{
              transform: `rotate(${dialRotation * 0.4}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)',
            }}
          >
            {outerTicks.map((t) => (
              <g key={t.id}>
                {/* Lower Specular Highlight (Milled Lip Catching Light) */}
                <line
                  x1={t.hx1}
                  y1={t.hy1}
                  x2={t.hx2}
                  y2={t.hy2}
                  stroke="rgba(255, 255, 255, 0.22)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
                {/* Deep Engraved Groove Shadow */}
                <line
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  stroke="#0A0614"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>

          {/* Left Slim Violet Anodized Metal Channel Arc */}
          <g id="anodized-band-group">
            {/* Outer Recessed Groove Shadow */}
            <path
              d={`
                M 255 0
                A ${rBandOuter + 2} ${rBandOuter + 2} 0 0 0 255 490
                L 333 490
                A ${rBandInner - 2} ${rBandInner - 2} 0 0 1 333 0
                Z
              `}
              fill="#06030C"
              opacity="0.8"
            />

            {/* Main Slim Anodized Metal Arc */}
            <path
              d={`
                M 257 0
                A ${rBandOuter} ${rBandOuter} 0 0 0 257 490
                L 331 490
                A ${rBandInner} ${rBandInner} 0 0 1 331 0
                Z
              `}
              fill="url(#anodizedBandGradient)"
              opacity="0.95"
            />

            {/* Outer Deep Cut Shadow Line on Band's Left Lip */}
            <path
              d={`
                M 257 0
                A ${rBandOuter} ${rBandOuter} 0 0 0 257 490
              `}
              fill="none"
              stroke="#06020C"
              strokeWidth="2"
            />
          </g>

          {/* Fine Dotted Circular Ring - Precision Machine-Punched Micro Dots */}
          <g id="dotted-ring-engraved">
            {/* Bottom Specular Highlight */}
            <circle
              cx={cx}
              cy={cy + 0.6}
              r={rBandInner - 12}
              fill="none"
              stroke="rgba(255, 255, 255, 0.28)"
              strokeWidth="2"
              strokeDasharray="2 6"
            />
            {/* Dark Groove */}
            <circle
              cx={cx}
              cy={cy}
              r={rBandInner - 12}
              fill="none"
              stroke="#0C0718"
              strokeWidth="2.2"
              strokeDasharray="2 6"
            />
          </g>

          {/* Rotating Radial Ticks Wheel Drum - Laser-Machined Engraved Grooves */}
          <g
            id="radial-ticks-wheel"
            style={{
              transform: `rotate(${dialRotation}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)',
            }}
          >
            {radialTicks.map((t) => (
              <g key={t.id}>
                {/* 1. Lower Specular Bevel Highlight */}
                <line
                  x1={t.hx1}
                  y1={t.hy1}
                  x2={t.hx2}
                  y2={t.hy2}
                  stroke={t.isMajor ? "rgba(255, 255, 255, 0.32)" : "rgba(255, 255, 255, 0.18)"}
                  strokeWidth={t.isMajor ? "1.5" : "0.9"}
                  strokeLinecap="round"
                />
                {/* 2. Top Dark Shadow */}
                <line
                  x1={t.sx1}
                  y1={t.sy1}
                  x2={t.sx2}
                  y2={t.sy2}
                  stroke="#05020A"
                  strokeWidth={t.isMajor ? "1.8" : "1.2"}
                  strokeLinecap="round"
                />
                {/* 3. Central Engraved Channel Body */}
                <line
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  stroke={t.isMajor ? "#281A3C" : t.isMedium ? "#1E1330" : "#160D24"}
                  strokeWidth={t.isMajor ? "2.0" : t.isMedium ? "1.4" : "1.0"}
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>

          {/* Horizontal Precision Steel Needle / Tuning Line Indicator with dynamic glow */}
          <g id="needle-group">
            {/* Stainless Steel Pointer Triangle with machined bevel */}
            <polygon
              points="125,245 135,240 135,250"
              fill="url(#anodizedBandGradient)"
              stroke="rgba(255, 255, 255, 0.7)"
              strokeWidth="0.8"
              className="drop-shadow-md"
            />
            <polygon
              points="126,245 134,241 134,249"
              fill="#FFFFFF"
            />

            {/* Under-glow for needle channel */}
            <line
              x1="135"
              y1="245"
              x2="284"
              y2="245"
              stroke={signalStrength > 0.6 ? "#F3E8FF" : "#D8B4FE"}
              strokeWidth="3.5"
              opacity="0.35"
              filter="url(#purpleGlow)"
            />

            {/* Glowing Violet Core Needle */}
            <line
              x1="135"
              y1="245"
              x2="284"
              y2="245"
              stroke={signalStrength > 0.6 ? "#FFFFFF" : isDragging ? "#E9D5FF" : "#D2C0FC"}
              strokeWidth={isDragging ? "2.4" : "2.0"}
              strokeLinecap="round"
              filter="url(#purpleGlow)"
              className="transition-all duration-150"
            />

            {/* Center-Left Needle Line Extension with Polished Steel Finish */}
            <line
              x1="284"
              y1="245"
              x2="310"
              y2="245"
              stroke={signalStrength > 0.6 ? "#C084FC" : "#8960D4"}
              strokeWidth="1.6"
              strokeLinecap="round"
              className="transition-colors duration-150"
            />
          </g>
        </svg>

        {/* Laser-Engraved Rotating Frequency Numbers along the metallic dial arc */}
        <div className="absolute inset-0 pointer-events-auto">
          {presets.map((pFreq) => {
            const angle = getAngleForFreq(pFreq);
            const rad = (angle * Math.PI) / 180;
            const rNum = 315; // Placed perfectly centered within the violet metal band
            const x = roundCoord(cx + rNum * Math.cos(rad));
            const y = roundCoord(cy + rNum * Math.sin(rad));
            const isClosest = Math.abs(frequency - pFreq) < (band === 'FM' ? 0.3 : 25);

            // Only render if visible in the dial arc window
            const isVisible = angle >= 100 && angle <= 260;
            if (!isVisible) return null;

            const leftPct = roundCoord((x / 720) * 100);
            const topPct = roundCoord((y / 490) * 100);

            return (
              <button
                key={`preset-${pFreq}`}
                id={`preset-btn-${pFreq}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleFrequencyChange(pFreq);
                }}
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 text-[14px] sm:text-[15px] font-bold cursor-pointer select-none ${
                  isDragging ? 'transition-none' : 'transition-all duration-200'
                } ${
                  isClosest
                    ? 'text-white scale-115'
                    : 'text-[#CDBCEE] hover:text-white'
                }`}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  // Deep laser-engraved metal deboss with specular lower bevel
                  textShadow: isClosest
                    ? '0 1px 0.5px rgba(255, 255, 255, 0.9), 0 -1.5px 2px rgba(0, 0, 0, 0.95), 0 0 12px rgba(230, 210, 255, 0.95)'
                    : '0 1px 0.5px rgba(255, 255, 255, 0.4), 0 -1.5px 2px rgba(0, 0, 0, 0.95)',
                }}
                title={`Tune to ${pFreq} ${band}`}
              >
                {pFreq}
              </button>
            );
          })}
        </div>

        {/* Small Engraved Capsule Needle Badge (◄ AM ► / ◄ FM ►) */}
        <div
          id="needle-badge"
          className="absolute z-10 flex items-center justify-center pointer-events-none"
          style={{
            left: '28.5%',
            top: '50.1%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[8px] tracking-wider font-bold transition-all ${
              signalStrength > 0.6
                ? 'bg-[#180E2E] border-[#A855F7] text-[#FAF5FF] shadow-[0_0_10px_rgba(168,85,247,0.7)]'
                : 'bg-[#110A20] border-[#3E2D5E] text-[#D8C7F8]'
            }`}
            style={{
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.3), inset 0 -1px 1px rgba(0,0,0,0.8), 0 2px 4px rgba(0,0,0,0.6)',
              textShadow: '0 1px 0 rgba(255,255,255,0.4), 0 -1px 1px rgba(0,0,0,0.95)',
            }}
          >
            <span className="text-[6px] opacity-70">◄</span>
            <span>{band}</span>
            <span className="text-[6px] opacity-70">►</span>
          </div>
        </div>

        {/* Top-Right Status Bar: Stamped REC button & Clock/Sync */}
        <div className="absolute top-7 right-9 flex items-center gap-4 z-20">
          {/* REC Button with matte milled pocket, debossed typography & LED indicator */}
          <button
            id="rec-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleRecording();
            }}
            className="flex items-center gap-2 cursor-pointer group transition-all hover:opacity-95 active:scale-95 px-3 py-1.5 rounded-full border border-[#3C2D5A]"
            style={{
              background: 'linear-gradient(180deg, #110A20 0%, #19102E 100%)',
              boxShadow: 'inset 0 1.5px 3px rgba(0,0,0,0.9), inset 0 -1px 1px rgba(255,255,255,0.18), 0 2px 6px rgba(0,0,0,0.5)',
            }}
          >
            <span
              className="text-[11px] font-extrabold tracking-wider text-[#DDD4F8] group-hover:text-white"
              style={{
                textShadow: '0 1px 0.5px rgba(255, 255, 255, 0.4), 0 -1.5px 2px rgba(0, 0, 0, 0.95)',
              }}
            >
              REC
            </span>
            <span
              className={`w-2 h-2 rounded-full transition-all duration-300 border border-black/60 ${
                isRecording
                  ? 'bg-[#FF2222] shadow-[0_0_12px_#FF2222,inset_0_1px_1px_#FFFFFF] animate-pulse'
                  : 'bg-[#D32F2F] shadow-[0_0_6px_#D32F2F,inset_0_0.8px_0.8px_rgba(255,255,255,0.7)]'
              }`}
            />
          </button>

          {/* Sync / Clock Display with Precision Stamped Metal Housing */}
          <div
            className="flex items-center gap-2 text-[#ECE8F5] px-3 py-1.5 rounded-full border border-[#3C2D5A]"
            style={{
              background: 'linear-gradient(180deg, #110A20 0%, #19102E 100%)',
              boxShadow: 'inset 0 1.5px 3px rgba(0,0,0,0.9), inset 0 -1px 1px rgba(255,255,255,0.18), 0 2px 6px rgba(0,0,0,0.5)',
            }}
          >
            <svg
              className={`w-3.5 h-3.5 text-[#D8C9F8] ${isPlaying ? 'animate-spin' : ''}`}
              style={{
                animationDuration: '6s',
                filter: 'drop-shadow(0 1px 0 rgba(255,255,255,0.3)) drop-shadow(0 -1px 1px rgba(0,0,0,0.95))',
              }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span
              className="text-[12px] font-extrabold tracking-wide text-[#EAE2F8]"
              style={{
                textShadow: '0 1px 0.5px rgba(255, 255, 255, 0.4), 0 -1.5px 2px rgba(0, 0, 0, 0.95)',
              }}
            >
              {isRecording ? formattedRecTime : currentTimeStr}
            </span>
          </div>
        </div>

        {/* Center-Right Information & Main Readout Display */}
        <div
          className="absolute z-20 flex flex-col items-center justify-center text-center pointer-events-auto"
          style={{
            left: '68%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Main Large Frequency Readout - Laser-Debossed Directly onto Matte Metal Faceplate */}
          <div
            id="frequency-display-engraved"
            onClick={(e) => {
              e.stopPropagation();
              togglePower();
            }}
            className="my-1 cursor-pointer select-none group transition-transform active:scale-[0.98]"
            title={isPlaying ? 'Click to Pause' : 'Click to Play'}
          >
            <span
              className={`text-[52px] sm:text-[58px] font-black tracking-tight leading-none transition-all duration-200 ${
                isPlaying
                  ? 'text-white'
                  : 'text-[#EFE8FF] group-hover:text-white'
              }`}
              style={{
                fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
                fontVariantNumeric: 'tabular-nums',
                textShadow: isPlaying
                  ? '0 1.5px 0.5px rgba(255, 255, 255, 0.75), 0 -2.5px 3px rgba(0, 0, 0, 0.95), 0 0 18px rgba(230, 210, 255, 0.75)'
                  : '0 1.5px 0.5px rgba(255, 255, 255, 0.4), 0 -2.5px 3px rgba(0, 0, 0, 0.95)',
              }}
            >
              {formattedFrequency}
            </span>
          </div>

          {/* Active Station Tagline / Genre if tuned - Laser Etched Text */}
          <div className="h-6 mt-2 flex items-center justify-center">
            {activeStation && isPlaying ? (
              <span
                className="text-[11px] font-bold text-[#E2D8FF] animate-fadeIn truncate max-w-[200px]"
                style={{
                  textShadow: '0 1px 0.5px rgba(255,255,255,0.4), 0 -1.5px 2px rgba(0,0,0,0.95)',
                }}
              >
                {activeStation.name}
              </span>
            ) : isPlaying ? (
              <span
                className="text-[11px] font-semibold text-[#A294C2] italic"
                style={{
                  textShadow: '0 1px 0.5px rgba(255,255,255,0.25), 0 -1.5px 1.5px rgba(0,0,0,0.95)',
                }}
              >
                Scanning static...
              </span>
            ) : (
              <span
                className="text-[11px] font-semibold text-[#80709F]"
                style={{
                  textShadow: '0 1px 0.5px rgba(255,255,255,0.2), 0 -1.5px 1.5px rgba(0,0,0,0.95)',
                }}
              >
                Standby • Tap to Start
              </span>
            )}
          </div>

          {/* FM / AM Mode Selector Switch - Precision Engraved Stamped Metal */}
          <div className="flex items-center gap-5 mt-2">
            <button
              id="fm-toggle-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleBand('FM');
              }}
              className={`text-[19px] font-black tracking-wider transition-all duration-150 cursor-pointer ${
                band === 'FM'
                  ? 'text-[#DDD0FA]'
                  : 'text-[#584872] hover:text-[#8874A8]'
              }`}
              style={{
                textShadow: band === 'FM'
                  ? '0 1px 0.5px rgba(255, 255, 255, 0.7), 0 -1.5px 2px rgba(0, 0, 0, 0.95), 0 0 10px rgba(196, 181, 253, 0.75)'
                  : '0 1px 0 rgba(255, 255, 255, 0.25), 0 -1.5px 1.5px rgba(0, 0, 0, 0.95)',
              }}
            >
              FM
            </button>
            <button
              id="am-toggle-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleBand('AM');
              }}
              className={`text-[19px] font-black tracking-wider transition-all duration-150 cursor-pointer ${
                band === 'AM'
                  ? 'text-[#DDD0FA]'
                  : 'text-[#584872] hover:text-[#8874A8]'
              }`}
              style={{
                textShadow: band === 'AM'
                  ? '0 1px 0.5px rgba(255, 255, 255, 0.7), 0 -1.5px 2px rgba(0, 0, 0, 0.95), 0 0 10px rgba(196, 181, 253, 0.75)'
                  : '0 1px 0 rgba(255, 255, 255, 0.25), 0 -1.5px 1.5px rgba(0, 0, 0, 0.95)',
              }}
            >
              AM
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
