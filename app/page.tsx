'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { radioEngine } from '@/lib/audio-player';
import { FM_STATIONS, AM_STATIONS, FM_SCALE_PRESETS, AM_SCALE_PRESETS, Station } from '@/lib/radio-engine';

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

  // Geometry configuration matching the reference image SVG
  const cx = 490;
  const cy = 245;
  const rBandOuter = 345;
  const rBandInner = 285;
  const rInnerTicks = 265;
  const rOuterTicks = 385;

  // Scale presets for the band
  const presets = band === 'FM' ? FM_SCALE_PRESETS : AM_SCALE_PRESETS;
  const baseFreq = band === 'FM' ? 98.8 : 880;
  const degMultiplier = band === 'FM' ? 5.2 : 0.08;

  // Compute rotation angle for the entire rotary tick drum
  // When frequency increases, dial rotates counter-clockwise so higher numbers come down toward needle
  const dialRotation = (frequency - baseFreq) * -degMultiplier;

  // Calculate angle for any frequency along the rotary circle
  // 98.8 MHz is centered near 197° (aligned with the needle pointer at left)
  const getAngleForFreq = useCallback((f: number) => {
    const defaultAngle = 180 + (f - 98.8) * 5.4;
    // When the dial rotates, the numbers shift along with the rotary knob
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
      // If user drags near the dial area (left / center), use angular rotary knob calculation
      if (x < 550) {
        const currentAngle = Math.atan2(y - cy, x - cx) * (180 / Math.PI);
        let angleDelta = currentAngle - dragStartAngleRef.current;
        // Normalize wrap-around
        if (angleDelta > 180) angleDelta -= 360;
        if (angleDelta < -180) angleDelta += 360;

        const freqDelta = -angleDelta / degMultiplier;
        handleFrequencyChange(startFreqRef.current + freqDelta);
      } else {
        // Fallback vertical drag
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

  // Memoize full 360° radial ticks around the rotary dial wheel
  const radialTicks = useMemo(() => {
    const ticks = [];
    const totalTicks = 96; // Dense realistic tick count
    for (let i = 0; i < totalTicks; i++) {
      const deg = (i / totalTicks) * 360;
      const rad = (deg * Math.PI) / 180;

      const isMajor = i % 4 === 0;
      const isMedium = i % 2 === 0;
      const tickLength = isMajor ? 28 : isMedium ? 18 : 11;
      const r1 = rInnerTicks;
      const r2 = rInnerTicks - tickLength;

      const x1 = roundCoord(cx + r1 * Math.cos(rad));
      const y1 = roundCoord(cy + r1 * Math.sin(rad));
      const x2 = roundCoord(cx + r2 * Math.cos(rad));
      const y2 = roundCoord(cy + r2 * Math.sin(rad));

      ticks.push({
        id: `in-${i}`,
        x1,
        y1,
        x2,
        y2,
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

      ticks.push({
        id: `out-${i}`,
        x1,
        y1,
        x2,
        y2,
      });
    }
    return ticks;
  }, []);

  return (
    <main
      id="radio-tuner-main"
      className="min-h-screen w-full flex items-center justify-center p-3 sm:p-6 select-none bg-[#CBB8F9] overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #CFBEFB 0%, #C4B0F7 50%, #BBA5F4 100%)',
      }}
    >
      {/* Central Skeuomorphic Radio Player Card */}
      <div
        id="radio-card"
        ref={cardRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className={`relative w-full max-w-[720px] aspect-[720/490] rounded-[34px] bg-[#09050F] text-white overflow-hidden shadow-2xl transition-transform ${
          isDragging ? 'cursor-grabbing scale-[0.998]' : 'cursor-grab active:scale-[0.998]'
        }`}
        style={{
          boxShadow:
            '0 35px 85px -15px rgba(85, 45, 155, 0.45), 0 15px 35px -5px rgba(0, 0, 0, 0.6), inset 0 1px 1px rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* SVG Graphic Layer for Dial, Ticks, Band, and Scale */}
        <svg
          viewBox="0 0 720 490"
          className="absolute inset-0 w-full h-full pointer-events-none"
        >
          <defs>
            {/* The Purple to Lavender Gradient for the Circular Band */}
            <linearGradient id="bandGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#6C3AD8" />
              <stop offset="35%" stopColor="#8A5CF6" />
              <stop offset="50%" stopColor="#D2C0FC" />
              <stop offset="65%" stopColor="#8A5CF6" />
              <stop offset="100%" stopColor="#5120AB" />
            </linearGradient>

            {/* Needle Glow Filter */}
            <filter id="purpleGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>

            {/* Dial Vignette & Depth Mask */}
            <radialGradient id="dialCenterMask" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#09050F" stopOpacity="1" />
              <stop offset="70%" stopColor="#09050F" stopOpacity="1" />
              <stop offset="100%" stopColor="#09050F" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Background Outer Tick Marks - Subtle Rotary Wheel Rotation */}
          <g
            id="outer-ticks-drum"
            style={{
              transform: `rotate(${dialRotation * 0.4}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)',
            }}
          >
            {outerTicks.map((t) => (
              <line
                key={t.id}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke="#392C50"
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity="0.6"
              />
            ))}
          </g>

          {/* Left Broad Violet Arc Band reaching from top border to bottom border */}
          <path
            d={`
              M 247 0
              A ${rBandOuter} ${rBandOuter} 0 0 0 247 490
              L 344 490
              A ${rBandInner} ${rBandInner} 0 0 1 344 0
              Z
            `}
            fill="url(#bandGradient)"
            opacity="0.95"
          />

          {/* Fine Dotted Circular Ring next to Band */}
          <circle
            cx={cx}
            cy={cy}
            r={rBandInner - 12}
            fill="none"
            stroke="#4A3B66"
            strokeWidth="2"
            strokeDasharray="2 6"
            opacity="0.8"
          />

          {/* Rotating Radial Ticks Wheel Drum */}
          <g
            id="radial-ticks-wheel"
            style={{
              transform: `rotate(${dialRotation}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: isDragging ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.9, 0.3, 1)',
            }}
          >
            {radialTicks.map((t) => (
              <line
                key={t.id}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                stroke={t.isMajor ? "#5D4485" : t.isMedium ? "#443460" : "#35274D"}
                strokeWidth={t.isMajor ? "2" : t.isMedium ? "1.4" : "1"}
                strokeLinecap="round"
                opacity="0.9"
              />
            ))}
          </g>

          {/* Mask inner center so right-side display stays pristine black */}
          <circle
            cx={cx}
            cy={cy}
            r={rInnerTicks - 32}
            fill="#09050F"
          />

          {/* Horizontal Needle / Tuning Line Indicator with dynamic illumination */}
          <g id="needle-group">
            {/* White Pointer Triangle on the outer left edge of the band */}
            <polygon
              points="126,245 135,241 135,249"
              fill={isDragging ? "#FFFFFF" : signalStrength > 0.6 ? "#EDE9FE" : "#FFFFFF"}
              className="drop-shadow-sm transition-colors"
            />

            {/* Horizontal Line passing through the purple band with enhanced glow on tuning */}
            <line
              x1="135"
              y1="245"
              x2="284"
              y2="245"
              stroke={signalStrength > 0.6 ? "#E9D5FF" : isDragging ? "#D8B4FE" : "#B39DDB"}
              strokeWidth={isDragging ? "2.6" : "2.2"}
              strokeLinecap="round"
              filter="url(#purpleGlow)"
              className="transition-all duration-150"
            />

            {/* Center-Left Needle Line Extension */}
            <line
              x1="284"
              y1="245"
              x2="310"
              y2="245"
              stroke={signalStrength > 0.6 ? "#A855F7" : "#7E57C2"}
              strokeWidth="1.5"
              className="transition-colors duration-150"
            />
          </g>
        </svg>

        {/* Clickable & Rotating Frequency Numbers along the dial arc */}
        <div className="absolute inset-0 pointer-events-auto">
          {presets.map((pFreq) => {
            const angle = getAngleForFreq(pFreq);
            const rad = (angle * Math.PI) / 180;
            // Radius where numbers sit just outside the arc
            const rNum = 378;
            const x = roundCoord(cx + rNum * Math.cos(rad));
            const y = roundCoord(cy + rNum * Math.sin(rad));
            const isClosest = Math.abs(frequency - pFreq) < (band === 'FM' ? 0.3 : 25);

            // Only render if visible within the left/top/bottom arc window
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
                className={`absolute transform -translate-x-1/2 -translate-y-1/2 text-[14px] sm:text-[15px] font-medium cursor-pointer ${
                  isDragging ? 'transition-none' : 'transition-all duration-200'
                } ${
                  isClosest
                    ? 'text-white scale-115 font-bold drop-shadow-[0_0_10px_rgba(210,192,252,0.9)]'
                    : 'text-[#6C5B88] hover:text-[#C4B5FD]'
                }`}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                }}
                title={`Tune to ${pFreq} ${band}`}
              >
                {pFreq}
              </button>
            );
          })}
        </div>

        {/* Small Capsule Needle Badge (◄ AM ► / ◄ FM ►) on the horizontal axis line */}
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
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#110C1D]/90 border shadow-sm text-[8px] tracking-wider font-semibold transition-all ${
              signalStrength > 0.6
                ? 'border-[#8B5CF6] text-[#E9D5FF] shadow-[0_0_8px_rgba(139,92,246,0.6)]'
                : 'border-[#3A2D54] text-[#B8A4E6]'
            }`}
          >
            <span className="text-[6px] opacity-70">◄</span>
            <span>{band}</span>
            <span className="text-[6px] opacity-70">►</span>
          </div>
        </div>

        {/* Top-Right Status Bar: REC button & Clock/Sync */}
        <div className="absolute top-8 right-10 flex items-center gap-6 z-20">
          {/* REC Button with glowing red LED */}
          <button
            id="rec-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleRecording();
            }}
            className="flex items-center gap-2 cursor-pointer group transition-opacity hover:opacity-90 active:scale-95"
          >
            <span className="text-[13px] font-medium tracking-wider text-[#D1C9E2] group-hover:text-white">
              REC
            </span>
            <span
              className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                isRecording
                  ? 'bg-[#FF2222] shadow-[0_0_12px_#FF2222] animate-pulse'
                  : 'bg-[#E53935] shadow-[0_0_8px_#E53935]'
              }`}
            />
          </button>

          {/* Sync / Clock Display */}
          <div className="flex items-center gap-2 text-[#ECE8F5]">
            <svg
              className={`w-3.5 h-3.5 text-[#ECE8F5] ${isPlaying ? 'animate-spin' : ''}`}
              style={{ animationDuration: '6s' }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <span className="text-[14px] font-medium tracking-wide">
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
          {/* Top Frequency & Channel Label */}
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-[20px] sm:text-[22px] font-semibold text-[#EDE8F8] tracking-tight">
              {band === 'FM' ? `${frequency.toFixed(1)} FM` : `${Math.round(frequency)} AM`}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#6E638A]">
              CHANNEL
            </span>
          </div>

          {/* Main Large Frequency Display Pill (Interactive Click to Play/Pause) */}
          <button
            id="frequency-display-pill"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePower();
            }}
            className="group relative flex items-center justify-center px-7 py-3 rounded-full bg-[#130E22] border border-[#2B2244] shadow-[inset_0_2px_4px_rgba(0,0,0,0.6),0_6px_20px_rgba(0,0,0,0.4)] hover:border-[#4B3B73] transition-all active:scale-[0.98] cursor-pointer"
            style={{
              minWidth: '180px',
            }}
            title={isPlaying ? 'Click to Pause' : 'Click to Play'}
          >
            {/* Glowing Digits */}
            <span
              className={`text-[42px] sm:text-[46px] font-extrabold tracking-tight transition-colors duration-200 ${
                isPlaying
                  ? 'text-white drop-shadow-[0_0_14px_rgba(255,255,255,0.45)]'
                  : 'text-[#EFEAFF]'
              }`}
              style={{
                fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formattedFrequency}
            </span>

            {/* Subtle Pulse ring when playing */}
            {isPlaying && (
              <span className="absolute -inset-0.5 rounded-full border border-[#8A5CF6]/30 animate-pulse pointer-events-none" />
            )}
          </button>

          {/* Active Station Tagline / Genre if tuned */}
          <div className="h-6 mt-2 flex items-center justify-center">
            {activeStation && isPlaying ? (
              <span className="text-[11px] font-medium text-[#C4B5FD] animate-fadeIn truncate max-w-[200px]">
                {activeStation.name}
              </span>
            ) : isPlaying ? (
              <span className="text-[11px] font-medium text-[#7C6C9C] italic">
                Scanning static...
              </span>
            ) : (
              <span className="text-[11px] font-medium text-[#564972]">
                Standby • Tap to Start
              </span>
            )}
          </div>

          {/* FM / AM Mode Selector Switch */}
          <div className="flex items-center gap-4 mt-2">
            <button
              id="fm-toggle-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleBand('FM');
              }}
              className={`text-[19px] font-bold tracking-wider transition-all duration-150 cursor-pointer ${
                band === 'FM'
                  ? 'text-[#9F7CFF] drop-shadow-[0_0_8px_rgba(159,124,255,0.7)]'
                  : 'text-[#473B61] hover:text-[#6D5D8F]'
              }`}
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
              className={`text-[19px] font-bold tracking-wider transition-all duration-150 cursor-pointer ${
                band === 'AM'
                  ? 'text-[#9F7CFF] drop-shadow-[0_0_8px_rgba(159,124,255,0.7)]'
                  : 'text-[#473B61] hover:text-[#6D5D8F]'
              }`}
            >
              AM
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
