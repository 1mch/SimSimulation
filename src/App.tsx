import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Wind, Info, Activity, ShieldAlert, Leaf, Droplets, Settings2, Sliders } from 'lucide-react';
import { Fraction, Cell, ProcessingDirection, SimulationStats } from './types';

// Simulation Constants
const AGE_STUBBORNNESS_THRESHOLD = 30;
const STUBBORNNESS_CHANCE = 0.2;
const MIGRATION_PENALTY = 0.5;

const FRACTION_HUE: Record<Exclude<Fraction, 'EMPTY'>, string> = {
  BLUE: '210, 80%', // HSL: 210 (Blue)
  GREEN: '140, 70%', // HSL: 140 (Green)
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  
  // Configuration State
  const [gridSize, setGridSize] = useState(80);
  const [blueInitial, setBlueInitial] = useState(15); // %
  const [greenInitial, setGreenInitial] = useState(15); // %
  const [speed, setSpeed] = useState(60); // 1-100
  
  // Rule State: Index corresponds to neighbor count (0-8)
  const [moveIfOwn, setMoveIfOwn] = useState<boolean[]>([true, true, true, false, false, false, false, false, false]); // Default: < 3
  const [moveIfForeign, setMoveIfForeign] = useState<boolean[]>([false, false, true, true, true, true, true, true, true]); // Default: > 1

  const [stats, setStats] = useState<SimulationStats>({
    iteration: 0,
    blueCount: 0,
    greenCount: 0,
    emptyCount: gridSize * gridSize,
  });
  
  const gridRef = useRef<Cell[][]>([]);
  const directionRef = useRef<ProcessingDirection>('NORTH');
  const animationFrameRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const calculateCellRenderSize = useCallback(() => {
    // We want to fit within a reasonable area, e.g., 600px
    return Math.floor(600 / gridSize);
  }, [gridSize]);

  // Initialize Grid
  const initGrid = useCallback(() => {
    const newGrid: Cell[][] = [];
    let blue = 0, green = 0, empty = 0;

    const bThreshold = blueInitial / 100;
    const gThreshold = (blueInitial + greenInitial) / 100;

    for (let y = 0; y < gridSize; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < gridSize; x++) {
        const rand = Math.random();
        let fraction: Fraction = 'EMPTY';
        if (rand < bThreshold) {
          fraction = 'BLUE';
          blue++;
        } else if (rand < gThreshold) {
          fraction = 'GREEN';
          green++;
        } else {
          empty++;
        }

        row.push({
          fraction,
          age: 0,
        });
      }
      newGrid.push(row);
    }
    gridRef.current = newGrid;
    setStats({
      iteration: 0,
      blueCount: blue,
      greenCount: green,
      emptyCount: empty,
    });
    render();
  }, [gridSize, blueInitial, greenInitial]);

  useEffect(() => {
    initGrid();
    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [initGrid]);

  const render = useCallback((progress: number = 1) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellRenderSize = calculateCellRenderSize();
    canvas.width = gridSize * cellRenderSize;
    canvas.height = gridSize * cellRenderSize;

    ctx.fillStyle = '#09090b'; // zinc-950
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const cell = gridRef.current[y][x];
        
        if (cell.fraction !== 'EMPTY') {
          const hue = FRACTION_HUE[cell.fraction];
          // Age darkening
          const lightness = Math.max(30, 70 - (cell.age / 100) * 40);
          ctx.fillStyle = `hsl(${hue}, ${lightness}%)`;
          
          let drawX = x;
          let drawY = y;
          
          // Smooth Interpolation
          if (cell.prevX !== undefined && cell.prevY !== undefined) {
            drawX = cell.prevX + (x - cell.prevX) * progress;
            drawY = cell.prevY + (y - cell.prevY) * progress;
          }
          
          ctx.fillRect(
            drawX * cellRenderSize + 1, 
            drawY * cellRenderSize + 1, 
            cellRenderSize - 2, 
            cellRenderSize - 2
          );
        }
      }
    }
  }, [gridSize, calculateCellRenderSize]);

  const tick = useCallback(() => {
    const currentGrid = gridRef.current;
    if (currentGrid.length === 0) return;
    
    const nextGrid = currentGrid.map(row => row.map(cell => ({ 
      fraction: cell.fraction, 
      age: cell.age 
    })));
    const order = directionRef.current;
    
    // Scan order logic
    const yOrder = (order === 'SOUTH') 
      ? Array.from({ length: gridSize }, (_, i) => gridSize - 1 - i) 
      : Array.from({ length: gridSize }, (_, i) => i);

    const xOrder = (order === 'EAST') 
      ? Array.from({ length: gridSize }, (_, i) => gridSize - 1 - i) 
      : Array.from({ length: gridSize }, (_, i) => i);

    let blue = 0, green = 0, emptyCount = 0;

    const processCell = (x: number, y: number) => {
      const cell = currentGrid[y][x];
      if (cell.fraction === 'EMPTY') {
        emptyCount++;
        return;
      }

      // Aging
      nextGrid[y][x].age++;

      // Neighbors
      let ownNeighbors = 0;
      let otherNeighbors = 0;
      const emptyNeighbors: { x: number, y: number }[] = [];

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const ny = y + dy;
          const nx = x + dx;
          if (ny >= 0 && ny < gridSize && nx >= 0 && nx < gridSize) {
            const neighbor = currentGrid[ny][nx];
            if (neighbor.fraction === cell.fraction) {
              ownNeighbors++;
            } else if (neighbor.fraction !== 'EMPTY') {
              otherNeighbors++;
            } else {
              emptyNeighbors.push({ x: nx, y: ny });
            }
          }
        }
      }

      // CUSTOM Rules: check state arrays
      const shouldMove = moveIfOwn[ownNeighbors] || moveIfForeign[otherNeighbors];

      // Stubbornness
      let finalShouldMove = shouldMove;
      if (shouldMove && cell.age > AGE_STUBBORNNESS_THRESHOLD) {
        if (Math.random() < STUBBORNNESS_CHANCE) finalShouldMove = false;
      }

      if (finalShouldMove && emptyNeighbors.length > 0) {
        const target = emptyNeighbors[Math.floor(Math.random() * emptyNeighbors.length)];
        const targetCellAtNext = nextGrid[target.y][target.x];

        if (targetCellAtNext.fraction === 'EMPTY') {
          nextGrid[target.y][target.x] = {
            ...cell,
            age: Math.floor(cell.age * MIGRATION_PENALTY),
            prevX: x,
            prevY: y,
          };
          nextGrid[y][x].fraction = 'EMPTY';
          nextGrid[y][x].age = 0;
        }
      }

      // Count for next stats (using updated positions as much as possible for real-time feel)
      // Actually, stats are best counted at the end of the full scan for accuracy
    };

    // Execute scanning
    if (order === 'WEST' || order === 'EAST') {
      for (const x of xOrder) {
        for (const y of yOrder) processCell(x, y);
      }
    } else {
      for (const y of yOrder) {
        for (const x of xOrder) processCell(x, y);
      }
    }

    // Final clean count for stats
    let finalBlue = 0, finalGreen = 0, finalEmpty = 0;
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        const f = nextGrid[y][x].fraction;
        if (f === 'BLUE') finalBlue++;
        else if (f === 'GREEN') finalGreen++;
        else finalEmpty++;
      }
    }

    gridRef.current = nextGrid;
    
    // Rotate Direction
    const directions: ProcessingDirection[] = ['NORTH', 'SOUTH', 'EAST', 'WEST'];
    directionRef.current = directions[(directions.indexOf(directionRef.current) + 1) % 4];

    setStats(prev => ({
      iteration: prev.iteration + 1,
      blueCount: finalBlue,
      greenCount: finalGreen,
      emptyCount: finalEmpty,
    }));
  }, [gridSize, render, moveIfOwn, moveIfForeign]);

  const loop = useCallback((time: number) => {
    if (lastTickRef.current === 0) lastTickRef.current = time;
    
    const elapsed = time - lastTickRef.current;
    const interval = 1000 / (speed / 2);
    
    // Calculate progress for current iteration animation
    const progress = Math.min(1, elapsed / interval);
    
    if (elapsed > interval) {
      tick();
      lastTickRef.current = time;
      // Start of new iteration, render once at 0 progress
      render(0);
    } else {
      // Interpolating frames
      render(progress);
    }
    
    animationFrameRef.current = requestAnimationFrame(loop);
  }, [speed, tick, render]);

  useEffect(() => {
    if (isRunning) animationFrameRef.current = requestAnimationFrame(loop);
    else cancelAnimationFrame(animationFrameRef.current);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [isRunning, loop]);

  const totalCells = gridSize * gridSize;
  const getPercentage = (count: number) => ((count / totalCells) * 100).toFixed(1);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-zinc-100 selection:text-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 p-6 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-widest opacity-50 font-mono">ECO-GRID CORE</span>
            <span className="bg-zinc-100 text-zinc-950 px-1 text-[10px] font-mono font-bold tracking-tighter">DARK_V2</span>
          </div>
          <h1 className="text-4xl font-serif italic font-medium tracking-tight bg-gradient-to-r from-zinc-100 to-zinc-500 bg-clip-text text-transparent">
            System Persistence
          </h1>
        </div>
        <div className="flex items-center gap-6 text-xs font-mono">
          <div className="flex flex-col items-end">
            <span className="opacity-40 text-[9px] uppercase tracking-widest">Iterácia</span>
            <span className="text-zinc-100 font-bold">{stats.iteration.toString().padStart(6, '0')}</span>
          </div>
          <div className="w-[1px] h-8 bg-zinc-800" />
          <div className="flex flex-col items-end">
            <span className="opacity-40 text-[9px] uppercase tracking-widest">Smer Vetra</span>
            <span className="text-zinc-100 font-bold flex items-center gap-1">
              <Wind size={12} className="opacity-60" />
              {directionRef.current}
            </span>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-[400px_1fr] min-h-[calc(100vh-100px)]">
        {/* Sidebar Controls */}
        <aside className="border-r border-zinc-800 flex flex-col overflow-y-auto">
          {/* Simulation Controls */}
          <section className="p-6 border-b border-zinc-800 space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <Settings2 size={18} className="opacity-60" />
              <h3 className="font-serif italic text-lg text-zinc-300">Konfigurácia Sveta</h3>
            </div>
            
            <div className="space-y-4">
              <ControlGroup 
                label="Rozlíšenie mriežky" 
                value={gridSize} 
                unit="buniek"
                min={20} 
                max={150} 
                onChange={setGridSize}
                onReset={resetSimulation}
              />
              <ControlGroup 
                label="Zelená frakcia" 
                value={greenInitial} 
                percent={`${greenInitial}%`}
                min={0} 
                max={50} 
                onChange={setGreenInitial}
                onReset={resetSimulation}
              />
              <ControlGroup 
                label="Modrá frakcia" 
                value={blueInitial} 
                percent={`${blueInitial}%`}
                min={0} 
                max={50} 
                onChange={setBlueInitial}
                onReset={resetSimulation}
              />
              <ControlGroup 
                label="Rýchlosť simulácie" 
                value={speed} 
                min={1} 
                max={100} 
                onChange={setSpeed}
              />

              {/* Dynamic Rules Selection */}
              <div className="space-y-4 pt-4 border-t border-zinc-800">
                <div className="space-y-3">
                  <span className="text-[9px] uppercase font-mono tracking-widest opacity-40">Pohon pri vlastných susedoch:</span>
                  <div className="grid grid-cols-9 gap-1">
                    {moveIfOwn.map((checked, i) => (
                      <button
                        key={`own-${i}`}
                        onClick={() => {
                          const next = [...moveIfOwn];
                          next[i] = !next[i];
                          setMoveIfOwn(next);
                        }}
                        className={`text-[10px] font-mono h-6 border rounded-sm transition-all ${
                          checked ? 'bg-zinc-100 text-zinc-950 border-zinc-100 font-bold' : 'bg-transparent text-zinc-500 border-zinc-800 hover:border-zinc-600'
                        }`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <span className="text-[9px] uppercase font-mono tracking-widest opacity-40">Pohon pri cudzích susedoch:</span>
                  <div className="grid grid-cols-9 gap-1">
                    {moveIfForeign.map((checked, i) => (
                      <button
                        key={`foreign-${i}`}
                        onClick={() => {
                          const next = [...moveIfForeign];
                          next[i] = !next[i];
                          setMoveIfForeign(next);
                        }}
                        className={`text-[10px] font-mono h-6 border rounded-sm transition-all ${
                          checked ? 'bg-zinc-100 text-zinc-950 border-zinc-100 font-bold' : 'bg-transparent text-zinc-500 border-zinc-800 hover:border-zinc-600'
                        }`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-4">
              <button 
                onClick={() => setIsRunning(!isRunning)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-sm transition-all font-mono text-sm uppercase tracking-widest ${
                  isRunning 
                    ? 'bg-zinc-100 text-zinc-950 hover:bg-zinc-300' 
                    : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
                }`}
              >
                {isRunning ? <Pause size={16} /> : <Play size={16} />}
                {isRunning ? 'Pozastaviť' : 'Spustiť'}
              </button>
              <button 
                onClick={resetSimulation}
                className="w-14 items-center justify-center flex bg-zinc-800 text-zinc-100 hover:bg-zinc-700 rounded-sm transition-colors border border-zinc-700"
              >
                <RotateCcw size={18} />
              </button>
            </div>
          </section>

          {/* Analytics */}
          <section className="p-6 border-b border-zinc-800 bg-zinc-950/50">
             <div className="flex items-center gap-2 mb-6">
                <Activity size={18} className="opacity-60" />
                <h3 className="font-serif italic text-lg text-zinc-300">Živá Analytika</h3>
             </div>
             
             <div className="space-y-6">
                <LiveStat 
                  label="Aqua-Blue" 
                  percent={getPercentage(stats.blueCount)} 
                  count={stats.blueCount} 
                  color="bg-blue-500" 
                  icon={<Droplets size={12} className="text-blue-400" />}
                />
                <LiveStat 
                  label="Bio-Green" 
                  percent={getPercentage(stats.greenCount)} 
                  count={stats.greenCount} 
                  color="bg-emerald-500" 
                  icon={<Leaf size={12} className="text-emerald-400" />}
                />
                <div className="pt-2 border-t border-zinc-900 flex justify-between text-[10px] font-mono opacity-40 uppercase tracking-widest">
                  <span>Voľné miesta</span>
                  <span>{stats.emptyCount}</span>
                </div>
             </div>
          </section>

          {/* Persistence Rules */}
          <section className="p-6 flex-grow bg-zinc-950">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert size={18} className="opacity-60" />
              <h3 className="font-serif italic text-lg text-zinc-300">Pravidlá Migrácie</h3>
            </div>
            <div className="space-y-3">
               <RuleItem index="01" text={`MOVE IF OWN: [${moveIfOwn.map((c, i) => c ? i : null).filter(x => x !== null).join(', ')}]`} />
               <RuleItem index="02" text={`MOVE IF OTHER: [${moveIfForeign.map((c, i) => c ? i : null).filter(x => x !== null).join(', ')}]`} />
               <RuleItem index="03" text="Pohyb na náhodné voľné susedné pole" />
               <RuleItem index="04" text="Odpor k sťahovaniu kumulovaný vekom" />
            </div>
          </section>
        </aside>

        {/* Animation Stage */}
        <div className="bg-zinc-900/20 p-8 flex items-center justify-center relative overflow-hidden backdrop-blur-sm">
           {/* Grid Pattern BG */}
           <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', maxSize: '40px 40px', backgroundSize: '40px 40px' }} 
           />
           
           <div className="relative z-10 p-2 bg-zinc-950 border border-zinc-800 shadow-[0_0_100px_rgba(0,0,0,0.5)]">
              <canvas 
                ref={canvasRef}
                className="block cursor-crosshair transition-opacity duration-300"
                style={{ opacity: isRunning ? 1 : 0.8 }}
              />
              
              {/* Overlay for non-running state */}
              {!isRunning && stats.iteration === 0 && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/60 backdrop-blur-sm cursor-pointer" onClick={() => setIsRunning(true)}>
                   <div className="flex flex-col items-center gap-4 text-zinc-100">
                      <div className="w-16 h-16 border border-zinc-100/30 rounded-full flex items-center justify-center animate-pulse">
                         <Play size={32} fill="currentColor" />
                      </div>
                      <span className="font-mono text-xs uppercase tracking-[0.3em] opacity-60">Inicializovať Simuláciu</span>
                   </div>
                </div>
              )}
           </div>

           {/* Scanning Edge Highlight */}
           <AnimatePresence>
             {isRunning && (
               <motion.div 
                 key={directionRef.current}
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 0.15 }}
                 exit={{ opacity: 0 }}
                 className={`absolute inset-0 pointer-events-none border-4 transition-all duration-300 ${
                   directionRef.current === 'NORTH' ? 'border-t-zinc-100 border-x-transparent border-b-transparent' :
                   directionRef.current === 'SOUTH' ? 'border-b-zinc-100 border-x-transparent border-t-transparent' :
                   directionRef.current === 'EAST' ? 'border-r-zinc-100 border-y-transparent border-l-transparent' :
                   'border-l-zinc-100 border-y-transparent border-r-transparent'
                 }`}
               />
             )}
           </AnimatePresence>
        </div>
      </main>
      
      <footer className="h-10 border-t border-zinc-800 bg-zinc-950 flex items-center px-6 justify-between text-[9px] font-mono uppercase tracking-[0.2em] opacity-30">
        <span>EST. 2026.IV.XXI</span>
        <span>Neural Grid Processing Unit / Status: Online</span>
      </footer>
    </div>
  );

  function resetSimulation() {
    setIsRunning(false);
    lastTickRef.current = 0;
    initGrid();
  }
}

function ControlGroup({ label, value, min, max, onChange, unit, percent, onReset }: any) {
  const handleChange = (val: number) => {
    onChange(val);
    if (onReset) onReset();
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-[10px] font-mono uppercase tracking-widest opacity-60">
        <span>{label}</span>
        <span className="text-zinc-100 font-bold">{percent || (value + ' ' + (unit || ''))}</span>
      </div>
      <input 
        type="range" 
        min={min} 
        max={max} 
        value={value} 
        onChange={(e) => handleChange(parseInt(e.target.value))}
        className="w-full appearance-none h-[2px] bg-zinc-800 accent-zinc-100 cursor-pointer hover:bg-zinc-700 transition-colors"
      />
    </div>
  );
}

function LiveStat({ label, percent, count, color, icon }: any) {
  return (
    <div className="group">
      <div className="flex justify-between items-end mb-2">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-[10px] uppercase font-mono tracking-widest opacity-60 group-hover:opacity-100 transition-opacity">
            {label}
          </span>
        </div>
        <span className="text-sm font-serif italic text-zinc-100">{percent}%</span>
      </div>
      <div className="h-[3px] bg-zinc-900 overflow-hidden relative">
        <motion.div 
          className={`h-full ${color} shadow-[0_0_10px_rgba(255,255,255,0.2)]`}
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ type: 'spring', bounce: 0, duration: 0.8 }}
        />
      </div>
      <div className="mt-1.5 text-[8px] font-mono text-right opacity-30 tracking-tigh">
        CELKOVÁ POPULÁCIA: {count.toLocaleString()}
      </div>
    </div>
  );
}

function RuleItem({ index, text }: { index: string, text: string }) {
  return (
    <div className="flex items-center gap-3 p-2 border border-transparent hover:border-zinc-800 hover:bg-zinc-900/50 rounded-sm transition-all group">
      <span className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-100 transition-colors">{index}</span>
      <p className="text-[11px] font-mono uppercase tracking-tight opacity-60 group-hover:opacity-100 transition-opacity">
        {text}
      </p>
    </div>
  );
}
