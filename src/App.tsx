/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  Zap, 
  Brain, 
  Settings, 
  Info, 
  Play, 
  Square, 
  RotateCcw,
  FlaskConical,
  Dna,
  Stethoscope
} from 'lucide-react';

// --- Types & Constants ---

type NerveType = 'median' | 'ulnar' | 'radial' | 'peroneal' | 'tibial' | 'sural';
type PathologyType = 'normal' | 'desmielinizante' | 'miastenia' | 'lambert' | 'denervacion' | 'fatiga';
type Mode = 'vcn' | 'emg' | 'tetanos';

interface PathologyParams {
  velocity: number;
  dispersion: number;
  amplitudeMult: number;
  info: string;
}

const NERVE_DATA: Record<NerveType, { label: string; group: string; muscle: string; baseV: number; normalLat: string }> = {
  median: { label: 'N. Mediano', group: 'Miembros Superiores', muscle: 'Abductor Pollicis Brevis', baseV: 56, normalLat: '< 4.4' },
  ulnar: { label: 'N. Cubital / Ulnar', group: 'Miembros Superiores', muscle: 'Abductor Digiti Minimi', baseV: 56, normalLat: '< 3.3' },
  radial: { label: 'N. Radial', group: 'Miembros Superiores', muscle: 'Extensor Indicis', baseV: 55, normalLat: '< 3.0' },
  peroneal: { label: 'N. Peroneo', group: 'Miembros Inferiores', muscle: 'Extensor Digitorum Brevis', baseV: 42, normalLat: '< 6.1' },
  tibial: { label: 'N. Tibial', group: 'Miembros Inferiores', muscle: 'Abductor Hallucis', baseV: 41, normalLat: '< 5.8' },
  sural: { label: 'N. Sural (Sensitivo)', group: 'Miembros Inferiores', muscle: 'Maleolo lateral', baseV: 40, normalLat: '< 4.5' },
};

// --- Utilities ---

const generateMUAP = (t: number, amplitude = 1, width = 1) => {
  return amplitude * (1 - 2 * Math.pow(t / width, 2)) * Math.exp(-Math.pow(t / width, 2));
};

export default function App() {
  // State
  const [nerve, setNerve] = useState<NerveType>('median');
  const [pathology, setPathology] = useState<PathologyType>('normal');
  const [mode, setMode] = useState<Mode>('vcn');
  const [distance, setDistance] = useState(25);
  const [isPaused, setIsPaused] = useState(false);
  const [stimCount, setStimCount] = useState(0);
  const [stats, setStats] = useState({ vcn: 0, latency: 0 });
  const [points, setPoints] = useState<number[]>([]);
  
  // Tetanus states
  const [frequency, setFrequency] = useState(10); // Hz (estimulaciones por segundo)
  const [isContinuousStim, setIsContinuousStim] = useState(false);
  const [voluntaryEffort, setVoluntaryEffort] = useState(0); // Esfuerzo voluntario %
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const emgBufferRef = useRef<number[]>([]);
  const tetanusBufferRef = useRef<number[]>([]);
  const calciumRef = useRef(0);
  const tensionRef = useRef(0);
  const lastStimTimeRef = useRef(0);
  const tetanusStimCountRef = useRef(0);
  const frameCountRef = useRef(0);
  const animationRef = useRef<number>(0);
  const artifactRef = useRef(0);

  // Memoized Pathology Params
  const pathologyParams = useMemo((): PathologyParams => {
    const baseV = NERVE_DATA[nerve].baseV;
    switch (pathology) {
      case 'desmielinizante':
        return { 
          velocity: baseV * 0.5, 
          dispersion: 4, 
          amplitudeMult: 0.6, 
          info: "Hallazgo: Disminución severa de la VCN y dispersión temporal del CMAP. Sugiere compromiso de la vaina de mielina." 
        };
      case 'miastenia':
        return { 
          velocity: baseV, 
          dispersion: 1.5, 
          amplitudeMult: Math.max(0.15, 1.0 - (stimCount * 0.15)), 
          info: "Hallazgo: Decremento progresivo de la amplitud. Típico de Miastenia Gravis por fatiga de la unión neuromuscular." 
        };
      case 'lambert':
        return { 
          velocity: baseV, 
          dispersion: 1.5, 
          amplitudeMult: Math.min(1.8, 0.4 + (stimCount * 0.25)), 
          info: "Hallazgo: Potencial inicial pequeño con incremento (facilitación) tras estímulos repetitivos. Característico de Lambert-Eaton." 
        };
      case 'denervacion':
        return { 
          velocity: baseV * 0.9, 
          dispersion: 1.5, 
          amplitudeMult: 0.7, 
          info: "Hallazgo: Potenciales de fibrilación y ondas agudas en reposo. Indica que las fibras musculares están denervadas." 
        };
      case 'fatiga':
        return { 
          velocity: baseV * 0.85, 
          dispersion: 2.2, 
          amplitudeMult: 0.75, 
          info: "Hallazgo: Pérdida de la frecuencia de disparo y caída de amplitud por agotamiento de la unidad motora." 
        };
      default:
        return { 
          velocity: baseV, 
          dispersion: 1.2, 
          amplitudeMult: 1.0, 
          info: "Resultado: Conducción normal para el nervio evaluado. Latencia y amplitud dentro de límites fisiológicos." 
        };
    }
  }, [pathology, nerve, stimCount]);

  // Trigger individual tetanus stimulus
  const triggerSingleTetanusStim = () => {
    tetanusStimCountRef.current = Math.min(50, tetanusStimCountRef.current + 1);
    
    let stimStrength = 18; // base calcium impulse for a standard twitch
    const count = tetanusStimCountRef.current;
    
    // Pathology modulations
    if (pathology === 'miastenia') {
      const decrement = Math.max(0.15, 1.0 - count * 0.08);
      stimStrength *= decrement;
    } else if (pathology === 'lambert') {
      const facilitation = Math.min(2.5, 0.4 + count * 0.15);
      stimStrength *= facilitation;
    } else if (pathology === 'fatiga') {
      const decline = Math.max(0.25, 1.0 - count * 0.04);
      stimStrength *= decline;
    } else if (pathology === 'desmielinizante') {
      stimStrength *= 0.7;
    }

    calciumRef.current += stimStrength;
  };

  // Handle Stimulus
  const handleTrigger = () => {
    setStimCount(prev => Math.min(10, prev + 1));
    const latencyMs = (distance * 10) / pathologyParams.velocity;
    const vcn = (distance / (latencyMs / 1000)) / 100;

    setStats({ vcn, latency: latencyMs });

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (mode === 'vcn') {
      // Generate response points for VCN mode
      const width = canvas.width;
      const newPoints: number[] = [];
      const sweepSpeed = 50; // ms

      for (let i = 0; i < width; i++) {
        const t = (i / width) * sweepSpeed;
        let val = 0;
        if (t > 0.5 && t < 1.5) val += (Math.random() - 0.5) * 60;
        if (t >= latencyMs && t < latencyMs + 20) {
          const localT = (t - latencyMs) - 5;
          val += generateMUAP(localT, 90 * pathologyParams.amplitudeMult, pathologyParams.dispersion);
        }
        newPoints.push(val);
      }
      setPoints(newPoints);
    } else if (mode === 'emg') {
      // In EMG mode, we just inject a artifact into the buffer (handled in render loop)
      artifactRef.current = 10; // 10 frames of artifact
    } else if (mode === 'tetanos') {
      // In Tetanus mode, we trigger a single twitch
      triggerSingleTetanusStim();
    }
  };

  const handleReset = () => {
    setPoints([]);
    emgBufferRef.current = [];
    tetanusBufferRef.current = [];
    calciumRef.current = 0;
    tensionRef.current = 0;
    tetanusStimCountRef.current = 0;
    setIsContinuousStim(false);
    setVoluntaryEffort(0);
    setStimCount(0);
    setStats({ vcn: 0, latency: 0 });
    frameCountRef.current = 0;
  };

  const toggleContinuousStim = () => {
    if (!isContinuousStim) {
      tetanusStimCountRef.current = 0; // reset counter for fresh run
      lastStimTimeRef.current = performance.now();
    }
    setIsContinuousStim(!isContinuousStim);
  };

  // Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      if (!isPaused) {
        const { width, height } = canvas;
        ctx.clearRect(0, 0, width, height);

        // Draw Grid
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        for (let i = 0; i < width; i += width / 10) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke();
        }
        for (let j = 0; j < height; j += height / 8) {
          ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(width, j); ctx.stroke();
        }

        // Baseline
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Repetitive stimulation in Tetanus Mode
        if (mode === 'tetanos' && isContinuousStim) {
          const now = performance.now();
          const intervalMs = 1000 / frequency; // interval based on selected Hz rate
          if (now - lastStimTimeRef.current >= intervalMs) {
            triggerSingleTetanusStim();
            lastStimTimeRef.current = now;
          }
        }

        if (mode === 'emg') {
          // Calculate Signal point
          let signal = 0;
          const activeUnitsCount = Math.ceil((voluntaryEffort / 100) * 8);

          if (activeUnitsCount > 0) {
            const emgTime = frameCountRef.current * 0.25;
            for (let i = 0; i < activeUnitsCount; i++) {
              const freq = (22 + i * 14) * (pathology === 'fatiga' ? 0.65 : 1.0);
              // Henneman size principle: larger motor units are recruited with greater effort and have higher amplitude
              const unitBaseAmp = (8 + i * 7) * pathologyParams.amplitudeMult;
              const effortScaling = (voluntaryEffort / 100);
              
              // Superpose individual motor unit action potentials (MUAP) with high frequency variation
              signal += Math.sin(emgTime * (freq / 10) + i) * unitBaseAmp * effortScaling;
            }

            if (pathology === 'denervacion') {
              if (Math.random() > 0.92) signal += (Math.random() - 0.5) * 160;
            } else if (pathology === 'miastenia') {
              const fade = Math.max(0.12, 1 - (frameCountRef.current % 800) / 800);
              signal *= fade;
            }

            // Electrode background thermal noise
            signal += (Math.random() - 0.5) * 6;
          } else {
            // Muscle at sleep/rest (Isoelectric Line)
            if (pathology === 'denervacion') {
              // Spontaneous denervation activity (fibrillations and positive sharp waves)
              if (Math.random() > 0.95) {
                signal += (Math.random() - 0.5) * 110;
              } else {
                signal += (Math.random() - 0.5) * 1.5;
              }
            } else {
              // Perfectly linear isoelectric line with minimal instrument noise
              signal = (Math.random() - 0.5) * 1.2;
            }
          }

          // Inject artifact if stimulated explicitly
          if (artifactRef.current > 0) {
            signal += (Math.random() - 0.5) * 200;
            artifactRef.current--;
          }

          // Add to buffer
          emgBufferRef.current.push(signal);
          if (emgBufferRef.current.length > width) {
            emgBufferRef.current.shift();
          }

          // Draw the buffer
          ctx.strokeStyle = '#4ade80';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          emgBufferRef.current.forEach((val, i) => {
            const y = height / 2 + val;
            if (i === 0) ctx.moveTo(i, y);
            else ctx.lineTo(i, y);
          });
          ctx.stroke();
        } else if (mode === 'tetanos') {
          // Calculate Tetanus simulation physics
          const isCompleteTetanus = frequency >= 32 && isContinuousStim;

          if (isCompleteTetanus) {
            // Under complete tetanus, we simulate direct fused calcium saturation
            // This prevents discrete stimulation pulses from inducing high-frequency step ripples
            const count = tetanusStimCountRef.current;
            let pathologyFactor = 1.0;
            if (pathology === 'miastenia') {
              pathologyFactor = Math.max(0.15, 1.0 - count * 0.08);
            } else if (pathology === 'lambert') {
              pathologyFactor = Math.min(2.5, 0.4 + count * 0.15);
            } else if (pathology === 'fatiga') {
              pathologyFactor = Math.max(0.25, 1.0 - count * 0.04);
            } else if (pathology === 'desmielinizante') {
              pathologyFactor = 0.7;
            }

            const targetCalcium = 120 * pathologyFactor;
            // Rise smoothly simulating complete biological fusion
            calciumRef.current = calciumRef.current + (targetCalcium - calciumRef.current) * 0.15;
          } else {
            // Standard decay for incomplete tetanus and isolated twitches
            const calciumDecay = 0.88;
            calciumRef.current = calciumRef.current * calciumDecay;
          }

          const tensionSpeed = isCompleteTetanus ? 0.08 : 0.12;
          const targetTension = calciumRef.current;
          // Tension crawls toward calcium (twitch build-up)
          tensionRef.current = tensionRef.current + (targetTension - tensionRef.current) * tensionSpeed;

          // Cap tension to prevent values from overflowing the screen heights
          if (tensionRef.current > 120) {
            tensionRef.current = 120;
          }

          const currentTension = tensionRef.current;
          let tensionTremor = 0;
          if (currentTension > 3 && !isCompleteTetanus) {
            // Tremor is proportional to current contraction target, larger at higher force
            // Completely disabled for complete tetanus to show NO oscillations or micro-relaxations
            tensionTremor = (Math.random() - 0.5) * (currentTension * 0.04 + 0.8);
          }

          // Tetanus tension draws upwards starting from the baseline
          const signal = -currentTension * 1.5 + tensionTremor;

          // Add to Tetanus buffer
          tetanusBufferRef.current.push(signal);
          if (tetanusBufferRef.current.length > width) {
            tetanusBufferRef.current.shift();
          }

          // Draw the buffer
          ctx.strokeStyle = '#c084fc'; // Beautiful purple for Tetanus
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          tetanusBufferRef.current.forEach((val, i) => {
            const y = height / 2 + val;
            if (i === 0) ctx.moveTo(i, y);
            else ctx.lineTo(i, y);
          });
          ctx.stroke();
        } else if (points.length > 0) {
          // Draw VCN CMAP
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          points.forEach((p, i) => {
            const y = height / 2 + p + (Math.random() - 0.5) * 1.5;
            if (i === 0) ctx.moveTo(i, y);
            else ctx.lineTo(i, y);
          });
          ctx.stroke();

          // Mark peak
          const minVal = Math.min(...points);
          if (minVal < -15) {
            const peakIdx = points.indexOf(minVal);
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(peakIdx, height / 2 + minVal, 6, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        frameCountRef.current++;
      }
      animationRef.current = requestAnimationFrame(render);
    };

    animationRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationRef.current);
  }, [isPaused, mode, points, pathology, pathologyParams.amplitudeMult, isContinuousStim, frequency, voluntaryEffort]);

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-blue-500/30 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row justify-between items-center bg-slate-800/80 backdrop-blur-md p-6 rounded-2xl border border-slate-700 shadow-2xl">
          <div className="space-y-2 text-center md:text-left w-full md:w-auto">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <h1 className="text-3xl font-black bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent flex items-center gap-3">
                <Brain className="text-blue-400" size={32} />
                NeuroSim <span className="text-xl font-medium text-slate-500 tracking-widest">v1.0</span>
              </h1>
              <a 
                href="https://www.youtube.com/@ProfeX-27" 
                target="_blank" 
                rel="noopener noreferrer"
                className="bg-red-600 hover:bg-red-500 active:scale-95 text-white text-xs font-bold px-4 py-1.5 rounded-full shadow-lg hover:shadow-red-900/50 flex items-center gap-1.5 transition-all w-fit"
                id="youtube-subscribe"
              >
                <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
                Suscríbete
              </a>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs uppercase tracking-[0.2em] font-semibold text-slate-400 flex items-center justify-center md:justify-start gap-2">
                <Stethoscope size={14} /> Simulador Neurofisiológico Avanzado
              </p>
              <p className="text-[11px] font-medium text-emerald-400 tracking-wider flex items-center justify-center md:justify-start gap-1">
                Creado por Xavier Obando
              </p>
            </div>
          </div>

          <div className="flex gap-4 mt-6 md:mt-0">
            <MetricCard 
              label={mode === 'tetanos' ? "Frecuencia" : mode === 'emg' ? "Esfuerzo Voluntario" : "VCN Calculada"} 
              value={mode === 'tetanos' ? `${frequency} Hz` : mode === 'emg' ? `${voluntaryEffort}%` : `${stats.vcn.toFixed(1)} m/s`} 
              unit="" 
              color={mode === 'tetanos' ? "text-purple-400" : mode === 'emg' ? "text-emerald-400" : "text-emerald-400"} 
              icon={<Zap size={16} />}
            />
            <MetricCard 
              label={mode === 'tetanos' ? "Tensión Muscular" : mode === 'emg' ? "U. Motoras Activas" : "Latencia Distal"} 
              value={mode === 'tetanos' ? `${Math.round(tensionRef.current * 0.83)}%` : mode === 'emg' ? `${Math.ceil((voluntaryEffort / 100) * 8)} / 8` : `${stats.latency.toFixed(2)} ms`} 
              unit="" 
              color={mode === 'tetanos' ? "text-fuchsia-400" : mode === 'emg' ? "text-teal-400" : "text-amber-400"} 
              icon={<Activity size={16} />}
            />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Controls Sidebar */}
          <aside className="lg:col-span-3 space-y-6">
            <section className="bg-slate-800/40 border border-slate-700/50 p-5 rounded-2xl space-y-5">
              <div className="flex items-center gap-2 text-slate-300 font-bold text-sm mb-2">
                <Settings size={18} className="text-blue-400" />
                Configuración
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Nervio Diana</label>
                  <select 
                    value={nerve}
                    onChange={(e) => { setNerve(e.target.value as NerveType); handleReset(); }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-blue-300 focus:ring-2 focus:ring-blue-500/50 outline-none transition"
                  >
                    {Object.entries(NERVE_DATA).map(([key, data]) => (
                      <option key={key} value={key}>{data.label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Condición Clínica</label>
                  <select 
                    value={pathology}
                    onChange={(e) => { setPathology(e.target.value as PathologyType); handleReset(); }}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-indigo-300 focus:ring-2 focus:ring-indigo-500/50 outline-none transition"
                  >
                    <option value="normal">Control Normal</option>
                    <option value="desmielinizante">Polineuropatía Desmielinizante</option>
                    <option value="miastenia">Miastenia Gravis (Decremento)</option>
                    <option value="lambert">Lambert-Eaton (Facilitación)</option>
                    <option value="denervacion">Denervación Aguda</option>
                    <option value="fatiga">Fatiga Crónica</option>
                  </select>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                    <span>Distancia Estimul.</span>
                    <span className="text-blue-400">{distance} cm</span>
                  </div>
                  <input 
                    type="range" min="5" max="60" value={distance}
                    onChange={(e) => setDistance(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>

                <AnimatePresence mode="popLayout">
                  {mode === 'tetanos' && (
                    <motion.div 
                      key="tetanos-controls"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-3 pt-3 border-t border-slate-700/30 overflow-hidden"
                    >
                      <div className="flex justify-between text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                        <span>Frecuencia Estímulos</span>
                        <span className="text-purple-400 font-bold">{frequency} Hz (estim/s)</span>
                      </div>
                      <input 
                        type="range" min="1" max="60" value={frequency}
                        onChange={(e) => setFrequency(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500 animate-pulse"
                      />
                      <div className="flex justify-between text-[9px] text-slate-500">
                        <span>1 Hz (Twitch)</span>
                        <span className="text-purple-300">10 Hz (Incompleto)</span>
                        <span>&gt;32 Hz (Completo)</span>
                      </div>
                    </motion.div>
                  )}

                  {mode === 'emg' && (
                    <motion.div 
                      key="emg-controls"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-3 pt-3 border-t border-slate-700/30 overflow-hidden"
                    >
                      <div className="flex justify-between text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                        <span>Esfuerzo Voluntario</span>
                        <span className="text-emerald-400 font-bold">{voluntaryEffort}%</span>
                      </div>
                      <input 
                        type="range" min="0" max="100" value={voluntaryEffort}
                        onChange={(e) => setVoluntaryEffort(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        id="emg-effort-slider"
                      />
                      <div className="flex justify-between text-[9px] text-slate-500">
                        <span>0% (Reposo)</span>
                        <span className="text-teal-300">35-70% (Parcial)</span>
                        <span>100% (Máximo)</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="pt-4 space-y-4">
                <div className="grid grid-cols-3 gap-1.5">
                  <button 
                    onClick={() => { setMode('vcn'); handleReset(); }}
                    className={`text-[9.5px] font-bold uppercase py-2.5 px-0.5 rounded-lg border transition ${mode === 'vcn' ? 'bg-blue-600 border-blue-400 text-white shadow-lg' : 'bg-slate-900 border-slate-850 text-slate-500 opacity-70'}`}
                  >
                    CMAP
                  </button>
                  <button 
                    onClick={() => { setMode('emg'); handleReset(); }}
                    className={`text-[9.5px] font-bold uppercase py-2.5 px-0.5 rounded-lg border transition ${mode === 'emg' ? 'bg-emerald-600 border-emerald-400 text-white shadow-lg' : 'bg-slate-900 border-slate-850 text-slate-500 opacity-70'}`}
                  >
                    EMG
                  </button>
                  <button 
                    onClick={() => { setMode('tetanos'); handleReset(); }}
                    className={`text-[9.5px] font-bold uppercase py-2.5 px-0.5 rounded-lg border transition ${mode === 'tetanos' ? 'bg-purple-600 border-purple-400 text-white shadow-lg' : 'bg-slate-900 border-slate-850 text-slate-500 opacity-70'}`}
                  >
                    Tétanos
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={handleTrigger}
                    className="bg-red-600 hover:bg-red-500 active:scale-95 text-white font-black py-4 rounded-xl shadow-xl shadow-red-900/20 transition-all text-[11px] tracking-wider uppercase flex items-center justify-center gap-1.5"
                  >
                    <Zap size={14} fill="currentColor" /> Estimular
                  </button>
                  <button 
                    onClick={toggleContinuousStim}
                    disabled={mode !== 'tetanos'}
                    className={`font-black py-4 rounded-xl transition-all text-[11px] tracking-wider uppercase flex items-center justify-center gap-1.5 ${
                      isContinuousStim 
                        ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-xl shadow-purple-950/40 animate-pulse' 
                        : 'bg-slate-750 border border-slate-650 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:pointer-events-none'
                    }`}
                  >
                    <Activity size={14} /> Repetitivo
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-700/30">
                  <button 
                    onClick={() => setIsPaused(!isPaused)}
                    className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl text-[10px] uppercase tracking-widest transition flex items-center justify-center gap-2"
                  >
                    {isPaused ? <Play size={14} fill="white" /> : <Square size={14} fill="white" />} 
                    {isPaused ? "Reanudar" : "Detener"}
                  </button>
                  <button 
                    onClick={handleReset}
                    className="bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-700 font-bold py-3 rounded-xl text-[10px] uppercase tracking-widest transition flex items-center justify-center gap-2"
                  >
                    <RotateCcw size={14} /> Reset
                  </button>
                </div>
              </div>
            </section>

            <section className="bg-blue-500/5 border border-blue-500/20 p-5 rounded-2xl">
              <div className="flex items-center gap-2 text-blue-400 font-bold text-sm mb-3">
                <FlaskConical size={18} />
                Ficha Técnica
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Músculo:</span>
                  <span className="text-slate-300 font-medium italic">{NERVE_DATA[nerve].muscle}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Normal VCN:</span>
                  <span className="text-emerald-500 font-bold">{NERVE_DATA[nerve].baseV} m/s</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Latencia Lím:</span>
                  <span className="text-amber-500 font-bold">{NERVE_DATA[nerve].normalLat} ms</span>
                </div>
              </div>
            </section>
          </aside>

          {/* Main Visualizer */}
          <main className="lg:col-span-9 space-y-6">
            
            {/* Oscilloscope Viewport */}
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl blur opacity-25 group-hover:opacity-40 transition duration-1000"></div>
              <div className="relative bg-black rounded-2xl border-2 border-slate-800 overflow-hidden shadow-3xl">
                
                {/* Labels/Telemetry Inside Canvas Overlay */}
                <div className="absolute top-4 left-4 z-20 space-y-1 bg-black/40 backdrop-blur-sm p-3 rounded-lg border border-slate-800/50">
                  <div className="text-[10px] font-mono font-bold text-emerald-500 flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" /> {mode === 'tetanos' ? 'SENS: 10 N/div' : mode === 'emg' ? 'SENS: 2 mV/div' : 'SENS: 5 mV/div'}
                  </div>
                  <div className="text-[10px] font-mono font-bold text-slate-500">{mode === 'tetanos' || mode === 'emg' ? 'SWEEP: REG. CONT.' : 'SWEEP: 5 ms/div'}</div>
                </div>

                <div className="absolute top-4 right-4 z-20 text-right space-y-1 bg-black/40 backdrop-blur-sm p-3 rounded-lg border border-slate-800/50">
                  <div className="text-[10px] font-mono text-blue-400">
                    {mode === 'tetanos' 
                      ? `Frecuencia: ${frequency} Hz` 
                      : mode === 'emg' 
                        ? `Esfuerzo: ${voluntaryEffort}%` 
                        : `Time: ${(frameCountRef.current * 0.1).toFixed(1)} ms`}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500">
                    {mode === 'tetanos' 
                      ? `Tensión: ${Math.round(tensionRef.current * 0.83)}%` 
                      : mode === 'emg' 
                        ? `U. Motoras: ${Math.ceil((voluntaryEffort / 100) * 8)}` 
                        : `Voltage: ${(Math.random() * 0.05).toFixed(2)} mV`}
                  </div>
                </div>

                <canvas 
                  ref={canvasRef} 
                  id="osc" 
                  width={900} 
                  height={400} 
                  className="w-full h-[400px] cursor-crosshair"
                />

                <AnimatePresence>
                  {points.length > 0 && mode === 'vcn' && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute bottom-4 left-4 right-4 text-center"
                    >
                      <span className="bg-blue-600/90 text-white text-[10px] font-black uppercase tracking-widest px-4 py-1 rounded-full shadow-lg">
                        Potencial Registrado
                      </span>
                    </motion.div>
                  )}

                  {mode === 'tetanos' && (
                    <motion.div 
                      key="tetanos-badge"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute bottom-4 left-4 right-4 text-center"
                    >
                      <span className={`text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full shadow-lg transition-all ${
                        frequency >= 32 
                          ? 'bg-red-600 border border-red-400 text-white glow-red' 
                          : frequency >= 5 
                            ? 'bg-amber-600 border border-amber-400 text-white' 
                            : 'bg-purple-600 border border-purple-450 text-white'
                      }`}>
                        {frequency >= 32 
                          ? 'Tétano Completo (Fusión Absoluta)' 
                          : frequency >= 5 
                            ? 'Tétano Incompleto (Sumación Temporal)' 
                            : 'Sacudidas Simples (Aisladas)'}
                      </span>
                    </motion.div>
                  )}

                  {mode === 'emg' && (
                    <motion.div 
                      key="emg-badge"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="absolute bottom-4 left-4 right-4 text-center"
                    >
                      <span className={`text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full shadow-lg transition-all ${
                        voluntaryEffort === 0
                          ? 'bg-slate-700/90 border border-slate-650 text-slate-300'
                          : voluntaryEffort >= 75
                            ? 'bg-emerald-600 border border-emerald-450 text-white animate-pulse'
                            : voluntaryEffort >= 35
                              ? 'bg-teal-600 border border-teal-450 text-white'
                              : 'bg-blue-600 border border-blue-450 text-white'
                      }`}>
                        {voluntaryEffort === 0 
                          ? 'Músculo en Reposo (Línea Isoeléctrica)' 
                          : voluntaryEffort >= 75 
                            ? 'Patrón de Interferencia Completo' 
                            : voluntaryEffort >= 35 
                              ? 'Patrón de Oscilación Intermedio' 
                              : 'Reclutamiento de Unidades Aisladas'}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Interpretation Card */}
            <motion.div 
              layout
              className="bg-slate-800/30 backdrop-blur-sm p-6 rounded-2xl border border-slate-700/50 flex items-start gap-4"
            >
              <div className="bg-indigo-500/10 p-3 rounded-xl">
                <Info className="text-indigo-400" size={24} />
              </div>
              <div className="space-y-2 flex-1">
                <h3 className="text-sm font-black text-slate-300 uppercase tracking-widest flex items-center gap-2">
                  Interpretación Clínica
                  <span className={`w-2 h-2 rounded-full ${pathology === 'normal' ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed italic">
                  {mode === 'tetanos' 
                    ? `Frecuencia seleccionada: ${frequency} Hz. ` + 
                      (frequency >= 32 
                        ? 'En el Tétano Completo (Fusión), los estímulos repetitivos son tan rápidos que el músculo no tiene tiempo para relajarse en lo absoluto. El calcio intracelular permanece constantemente elevado y los twitches individuales se fusionan en una contracción máxima y perfectamente sostenida (meseta).' 
                        : frequency >= 5 
                          ? 'En el Tétano Incompleto, los estímulos repetitivos se aplican con suficiente frecuencia para sumarse, pero con suficiente intervalo para permitir que el músculo se relaje parcialmente. Esto genera una fuerza de contracción oscilante y un patrón de ondas sumatorias.' 
                          : 'A frecuencias extremadamente bajas (1-4 Hz), se observan sacudidas musculares aisladas prácticamente completas antes de que llegue la siguiente estimulación, sin sumación significativa.') +
                      (pathology === 'miastenia' 
                        ? ' [Condición de Miastenia]: Al iniciar estímulos continuos, se aprecia un patrón decrementante por el rápido agotamiento de la acetilcolina disponible en los receptores.' 
                        : pathology === 'lambert' 
                          ? ' [Condición de Lambert-Eaton]: La estimulación repetida aumenta el influjo de calcio intracelular resolviendo parcialmente el bloqueo presináptico y produciendo una facilitación notable (aumento progresivo).' 
                          : '')
                    : mode === 'emg'
                      ? `Esfuerzo voluntario: ${voluntaryEffort}%. ` +
                        (voluntaryEffort === 0
                          ? 'Músculo en completo reposo. Se registra una línea isoeléctrica calibrada (salvo potenciales espontáneos patológicos en caso de denervación o mínimos ruidos bioeléctricos de electrodo).'
                          : `Se observan ${Math.ceil((voluntaryEffort / 100) * 8)} unidad(es) motora(s) reclutada(s). ` +
                            (voluntaryEffort >= 75
                              ? 'Patrón de interferencia completo: los potenciales de acción de las unidades motoras se superponen tanto por el esfuerzo que es imposible distinguir la línea basal.'
                              : voluntaryEffort >= 35
                                ? 'Patrón transicional o intermedio: aumento en la frecuencia de disparo y número de unidades activas con basal aún parcialmente visible.'
                                : 'Patrón de oscilación simple: activación de las primeras unidades de menor tamaño acatando el principio de tamaño de Henneman.')
                        ) +
                        (pathology === 'denervacion'
                          ? ' [Condición de Denervación]: Destaca la presencia de fibrilaciones y ondas agudas espontáneas durante el reposo absoluto debido a la hipersensibilidad del sarcolema denervado.'
                          : pathology === 'miastenia'
                            ? ' [Condición de Miastenia]: Al sostener el esfuerzo voluntario, se observa un agotamiento transitorio del patrón de interferencia debido a la fatiga sináptica por bloqueo de receptores de ACh.'
                            : pathology === 'fatiga'
                              ? ' [Condición de Fatiga Crónica]: Incapacidad para reclutar o sostener un patrón de interferencia completo a pesar del esfuerzo del paciente por agotamiento de la neurotransmisión o metabolitos.'
                              : '')
                      : pathologyParams.info
                  }
                </p>
              </div>
            </motion.div>

            {/* Reference Table Section */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
               <div className="p-4 bg-slate-800/50 border-b border-slate-800 flex items-center justify-between">
                 <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <Dna size={14} className="text-blue-500" /> Valores Referenciales (VCN)
                 </h4>
               </div>
               <div className="overflow-x-auto">
                 <table className="w-full text-left">
                   <thead>
                     <tr className="bg-slate-950/20 text-[9px] text-slate-500 uppercase font-black">
                       <th className="p-4">Nervio Evaluado</th>
                       <th className="p-4 text-center">Velocidad Mín (m/s)</th>
                       <th className="p-4 text-center">Lat. Distal Máx (ms)</th>
                       <th className="p-4">Inervación Diana</th>
                     </tr>
                   </thead>
                   <tbody className="text-xs divide-y divide-slate-800/50">
                     {Object.entries(NERVE_DATA).map(([key, data]) => (
                       <tr key={key} className="hover:bg-slate-800/20 transition-colors">
                         <td className="p-4 font-bold text-blue-300">{data.label}</td>
                         <td className="p-4 text-center font-mono text-emerald-400">{data.baseV} - {(data.baseV * 1.1).toFixed(0)}</td>
                         <td className="p-4 text-center font-mono text-amber-400">{data.normalLat}</td>
                         <td className="p-4 text-slate-500 italic">{data.muscle}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            </div>
          </main>
        </div>
      </div>

      {/* Footer Decoration */}
      <footer className="mt-12 text-center text-slate-600 text-[10px] font-medium tracking-widest uppercase pb-8">
        &copy; 2026 NeuroSim &bull; Advanced Electrophysiology Simulation Suite
      </footer>
    </div>
  );
}

// --- Helper Components ---

function MetricCard({ label, value, unit, color, icon }: { label: string; value: string; unit: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-slate-900/80 border border-slate-700/50 px-5 py-3 rounded-xl min-w-[140px] shadow-inner group">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] uppercase font-black text-slate-500 tracking-tighter">{label}</span>
        <span className={`${color} opacity-40 group-hover:opacity-100 transition-opacity`}>{icon}</span>
      </div>
      <div className={`text-xl font-mono font-black ${color}`}>
        {value} <span className="text-[10px] font-normal">{unit}</span>
      </div>
    </div>
  );
}
