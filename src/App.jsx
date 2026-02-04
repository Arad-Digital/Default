import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, GripVertical, X, Info, ChevronDown, Check, Filter, Loader2, Star, Hammer, Hash } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, writeBatch } from 'firebase/firestore';

// --- FIREBASE SETUP ---
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// --- CONSTANTS & HELPERS ---
const DEFAULT_ITEMS = [
  { content: "Lancio nuova App Mobile", axisX: 'consumer', axisY: 'nuovo', tags: ['B:Valutazione costo/beneficio', 'Dev:Prototipazione'], appetibility: 5, effort: 4, createdAt: "2023-01-01" },
  { content: "Ottimizzazione CRM", axisX: 'internal', axisY: 'esistente', tags: ['M:Analisi KPI'], appetibility: 3, effort: 2, createdAt: "2023-01-02" },
  { content: "Restyling Portale Clienti", axisX: 'consumer', axisY: 'esistente', tags: ['Des:Analisi dei competitor', 'Des:Definizione requisiti'], appetibility: 4, effort: 3, createdAt: "2023-01-03" },
  { content: "Automazione HR con AI", axisX: 'internal', axisY: 'nuovo', tags: [], appetibility: 4, effort: 5, createdAt: "2023-01-04" },
];

const LEGEND_DATA = [
  {
    id: 'B',        // ID Univoco per logica
    letter: 'B',    // Lettera visualizzata
    theme: 'rose',
    color: 'bg-[#e06666]',
    hex: '#e06666',
    border: 'border-[#e06666]',
    text: 'text-[#e06666]',
    label: 'Business', // Ex Economics
    items: ['Valutazione costo/beneficio', 'Valutazione market opportunity']
  },
  {
    id: 'Des',      // ID Univoco per Design
    letter: 'D',    // Lettera visualizzata
    theme: 'amber',
    color: 'bg-[#ee7630]',
    hex: '#ee7630',
    border: 'border-[#ee7630]',
    text: 'text-[#ee7630]',
    label: 'Design',
    items: ['Definizione requisiti', 'Analisi dei competitor', 'Studio di fattibilità']
  },
  {
    id: 'Dev',      // ID Univoco per Development
    letter: 'D',    // Lettera visualizzata
    theme: 'emerald',
    color: 'bg-[#1a5c42]',
    hex: '#1a5c42',
    border: 'border-[#1a5c42]',
    text: 'text-[#1a5c42]',
    label: 'Development', // Ex Sviluppo
    items: ['Design della soluzione', 'Piano di implementazione', 'Prototipazione']
  },
  {
    id: 'M',
    letter: 'M',
    theme: 'blue',
    color: 'bg-[#0ab0e2]',
    hex: '#0ab0e2',
    border: 'border-[#0ab0e2]',
    text: 'text-[#0ab0e2]',
    label: 'Management',
    items: ['Analisi KPI', 'Feedback loop', 'Reportistica periodica']
  }
];

const parseTag = (tagString) => {
  if (!tagString) return null;
  const parts = tagString.split(':');
  const prefix = parts[0]; // Ora usiamo l'ID come prefisso (B, Des, Dev, M)
  const detail = parts.length > 1 ? parts[1] : null;

  // Trova basandosi sull'ID univoco
  const legendItem = LEGEND_DATA.find(l => l.id === prefix);

  return {
    letter: legendItem ? legendItem.letter : prefix.charAt(0),
    detail: detail || legendItem?.label || 'Generico',
    color: legendItem ? legendItem.color : 'bg-slate-400',
    fullString: tagString,
    legendItem: legendItem // Ritorna l'intero item per accesso a props
  };
};

const getAppetibilityLabel = (score) => {
  switch(score) {
    case 1: return "Bassa";
    case 2: return "Discreta";
    case 3: return "Buona";
    case 4: return "Ottima";
    case 5: return "Irresistibile!";
    default: return "N/D";
  }
};

const getEffortLabel = (score) => {
  switch(score) {
    case 1: return "Minimo";
    case 2: return "Basso";
    case 3: return "Medio";
    case 4: return "Alto";
    case 5: return "Molto Alto";
    default: return "N/D";
  }
};

// --- BACKGROUND COMPONENT ---
const BackgroundDecorations = () => {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden -z-10">
      {/* SHAPES INSPIRED BY STICKER SHEET */}

      {/* Shape 1: Arch/Semi-circle (Rose) - Top Left */}
      <div
        className="absolute top-[-5%] left-[-5%] w-[35vw] h-[35vw] bg-[#e06666] opacity-[0.12] blur-[80px] animate-wander-slow"
        style={{ borderRadius: '50% 50% 0 0' }}
      />

      {/* Shape 2: Quarter Circle (Amber) - Top Right */}
      <div
        className="absolute top-[10%] right-[-10%] w-[40vw] h-[40vw] bg-[#ee7630] opacity-[0.10] blur-[90px] animate-wander-medium"
        style={{ borderRadius: '0 0 0 100%', animationDelay: '-2s' }}
      />

      {/* Shape 3: Diamond (Blue) - Bottom Right */}
      <div
        className="absolute bottom-[-10%] right-[5%] w-[45vw] h-[45vw] bg-[#0ab0e2] opacity-[0.12] blur-[100px] animate-wander-fast"
        style={{ clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)', animationDelay: '-5s' }}
      />

      {/* Shape 4: Organic/Blob (Emerald) - Bottom Left */}
      <div
        className="absolute bottom-[10%] left-[-10%] w-[30vw] h-[30vw] bg-[#1a5c42] opacity-[0.10] blur-[70px] animate-wander-slow"
        style={{ borderRadius: '60% 40% 30% 70% / 60% 30% 70% 40%', animationDelay: '-7s' }}
      />

      {/* Subtle Grain Texture Overlay */}
      <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }} />
    </div>
  );
};

// --- COMPONENTS ---

const Tooltip = ({ x, y, content, visible }) => {
  if (!visible) return null;

  return (
    <div
      className="fixed z-50 px-3 py-2 bg-[#004a2e] text-[#f1f1e9] text-xs rounded shadow-xl pointer-events-none transition-opacity duration-200"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, -100%)',
        marginTop: '-8px',
        whiteSpace: 'pre-line',
        maxWidth: '250px'
      }}
    >
      {content}
      <div className="absolute left-1/2 bottom-0 w-2 h-2 -mb-1 bg-[#004a2e] transform -translate-x-1/2 rotate-45"></div>
    </div>
  );
};

const LegendBox = ({ data, activeFilters, onToggleCategory, onToggleFilterItem }) => {
  // Use data.id (prefix) for logic
  const categoryFilters = data.items.map(item => `${data.id}:${item}`);
  const activeCount = categoryFilters.filter(f => activeFilters.includes(f)).length;
  const isPartiallyActive = activeCount > 0;

  const isActive = isPartiallyActive;

  const containerClasses = isActive
    ? `bg-[#f1f1e9]/80 backdrop-blur-sm border-2 ${data.border} shadow-md ring-1 ring-${data.theme}-100`
    : `bg-[#f1f1e9]/60 backdrop-blur-sm border-2 border-slate-200 shadow-sm opacity-80 hover:opacity-100`;

  const textClasses = isActive ? data.text : 'text-slate-400';

  return (
    <div className="relative group z-20">
      <div
        onClick={() => onToggleCategory(data.id)}
        className={`p-4 rounded-xl flex flex-col items-center justify-center cursor-pointer transition-all duration-200 hover:-translate-y-1 ${containerClasses}`}
      >
        <span
          className={`text-2xl md:text-3xl font-black transition-colors ${textClasses}`}
          style={{ fontFamily: "'Gowun Batang', serif" }}
        >
          {data.letter}
        </span>
        <div className={`mt-1 flex items-center gap-1 transition-opacity ${isActive ? 'opacity-100' : 'opacity-60'}`}>
           <span
             className={`text-[10px] uppercase font-bold tracking-wider ${textClasses}`}
             style={{ fontFamily: "'IBM Plex Mono', monospace" }}
           >
             {isActive ? 'Attivo' : 'Filtra'}
           </span>
           <ChevronDown size={14} className={textClasses} />
        </div>
      </div>

      <div className="absolute left-0 top-full pt-2 w-full min-w-[240px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-top -translate-y-2 group-hover:translate-y-0 z-30">
        <div className={`bg-[#f1f1e9] rounded-lg shadow-xl border-2 ${data.border} overflow-hidden`}>
          <div className={`bg-white/40 px-3 py-2 border-b ${data.border} flex justify-between items-center`}>
            <span className={`text-xs font-bold uppercase tracking-wider ${data.text}`}>{data.label}</span>
            {isActive && (
              <span className={`text-[10px] ${data.text} font-bold px-1.5 py-0.5`}>{activeCount}/{categoryFilters.length}</span>
            )}
          </div>
          <ul className="py-1">
            {data.items.map((item, idx) => {
              const filterTag = `${data.id}:${item}`;
              const isSelected = activeFilters.includes(filterTag);
              return (
                <li
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFilterItem(filterTag);
                  }}
                  className={`px-4 py-2 text-sm cursor-pointer flex items-center justify-between transition-colors
                    ${isSelected ? 'bg-white/60 font-medium text-[#133817]' : 'text-[#133817] hover:bg-white/40'}
                  `}
                  style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  <span>{item}</span>
                  {isSelected && <Check size={14} className={data.text} />}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};

const Card = ({ item, isActive, onDelete, onEdit, onDragStart, onShowTooltip, onHideTooltip, displayId }) => {
  return (
    <div
      draggable={isActive}
      onDragStart={(e) => isActive && onDragStart(e, item.id)}
      className={`
        p-3 rounded-lg shadow-sm border border-slate-200
        transition-all duration-300 relative z-10 flex flex-col gap-3 shrink-0
        ${isActive
          ? 'bg-[#f1f1e9] opacity-100 hover:shadow-md cursor-move'
          : 'bg-white opacity-40 grayscale'
        }
      `}
    >
      <div className="flex justify-between items-start w-full">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {/* ID VISIBILE */}
          <div className="flex flex-col items-center justify-start mt-0.5">
             <GripVertical className={`w-4 h-4 flex-shrink-0 transition-opacity ${isActive ? 'text-[#133817] group-hover:opacity-100' : 'text-slate-300 opacity-0'}`} />
             <span className="text-[10px] font-mono text-slate-400 mt-1">#{displayId}</span>
          </div>

          <p
            onClick={() => onEdit(item)}
            className={`text-sm leading-relaxed w-full cursor-pointer font-medium line-clamp-2 text-ellipsis overflow-hidden ${isActive ? 'text-[#133817] hover:text-[#4c806c]' : 'text-[#133817] opacity-80'}`}
            title="Clicca per modificare"
          >
            {item.content}
          </p>
        </div>
        {isActive && (
          <div className="flex gap-1 pl-2 shrink-0">
            <button
              onClick={() => onDelete(item.id)}
              className="text-[#133817] hover:text-red-500 transition-colors p-1"
              title="Elimina"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Footer: Stats (Sinistra) & Dash (Destra) */}
      <div className="flex justify-between items-end mt-auto pt-1 h-6">

        {/* Gruppo Stats: Appetibilità & Effort */}
        <div className="flex gap-3 items-center pb-0.5">
          {item.appetibility > 0 && (
            <div className="flex items-center gap-1.5" title={`Appetibilità: ${item.appetibility}/5`}>
              <Star size={16} className="text-[#133817] fill-[#133817]" strokeWidth={0} />
              <span className="text-xs font-bold text-[#133817]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{item.appetibility}</span>
            </div>
          )}
          {item.effort > 0 && (
            <div className="flex items-center gap-1.5" title={`Effort: ${item.effort}/5`}>
              <Hammer size={16} className="text-[#133817] fill-[#133817]" strokeWidth={0} />
              <span className="text-xs font-bold text-[#133817]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{item.effort}</span>
            </div>
          )}
        </div>

        {/* Gruppo Dash Verticali */}
        <div className="flex gap-1.5 items-end h-full">
          {LEGEND_DATA.map((legendItem) => {
            // Usa id (prefix) per il matching dei tag
            const tagsForThisLetter = item.tags ? item.tags.filter(t => t.startsWith(legendItem.id + ':')) : [];
            const hasTag = tagsForThisLetter.length > 0;

            let tooltipText = '';
            if (hasTag) {
              const tooltipDetails = tagsForThisLetter.map(t => parseTag(t)?.detail).filter(Boolean);
              tooltipText = `${legendItem.letter} (${legendItem.label}):\n• ${tooltipDetails.join('\n• ')}`;
            } else {
              tooltipText = `${legendItem.letter} (Nessun tag)`;
            }

            return (
              <div
                key={legendItem.id}
                className={`
                  w-1.5 h-5 rounded-full transition-all duration-300
                  ${hasTag
                    ? (isActive ? legendItem.color : 'bg-slate-500')
                    : 'bg-slate-200'
                  }
                  ${hasTag ? 'cursor-help' : ''}
                `}
                onMouseEnter={(e) => hasTag && onShowTooltip(e, tooltipText)}
                onMouseLeave={onHideTooltip}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

const Quadrant = ({
  title,
  subtitle,
  items,
  activeFilters,
  typeX,
  typeY,
  bgColor,
  borderColor,
  onDrop,
  onDelete,
  onEdit,
  onAdd,
  onDragStart,
  onShowTooltip,
  onHideTooltip
}) => {
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    onDrop(typeX, typeY);
  };

  const isCardActive = (item) => {
    if (activeFilters.length === 0) return false;
    return item.tags && item.tags.some(tag => activeFilters.includes(tag));
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`relative flex flex-col h-full min-h-[250px] p-4 rounded-xl border-2 ${borderColor} ${bgColor} bg-opacity-70 backdrop-blur-sm transition-colors group/quadrant overflow-hidden`}
    >
      <div className="mb-4 pr-6 shrink-0">
        <h3 className="font-bold text-[#133817] uppercase tracking-wide text-xs">{title}</h3>
        <p
          className="text-xs text-[#133817] mt-1"
          style={{ fontFamily: "'IBM Plex Mono', monospace" }}
        >
          {subtitle}
        </p>
      </div>

      <button
        onClick={() => onAdd(typeX, typeY)}
        className="absolute top-3 right-3 p-1.5 bg-white/50 hover:bg-[#f1f1e9] rounded-full text-slate-500 hover:text-[#133817] transition-all shadow-sm opacity-100 md:opacity-0 md:group-hover/quadrant:opacity-100 z-20"
        title="Aggiungi in questo quadrante"
      >
        <Plus size={18} />
      </button>

      <div className="flex-1 flex flex-col gap-2 overflow-y-auto min-h-0 pr-1 scrollbar-hide">
        {items.length === 0 ? (
          <div className="flex-1 flex items-center justify-center border-2 border-dashed border-slate-300/50 rounded-lg min-h-[100px]">
            <span className="text-xs text-slate-400 font-medium">Trascina qui</span>
          </div>
        ) : (
          items.map(item => (
            <Card
              key={item.id}
              item={item}
              displayId={item.displayId} // Passiamo il display ID calcolato
              isActive={isCardActive(item)}
              onDelete={onDelete}
              onEdit={onEdit}
              onDragStart={onDragStart}
              onShowTooltip={onShowTooltip}
              onHideTooltip={onHideTooltip}
            />
          ))
        )}
      </div>
    </div>
  );
};

// --- CHART COMPONENT ---
const EffortValueChart = ({ items }) => {
  const chartRef = useRef(null);

  // Group items by coordinates to handle collisions
  const groupedItems = items.reduce((acc, item) => {
    if (item.appetibility > 0 && item.effort > 0) {
      const key = `${item.effort}-${item.appetibility}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
    }
    return acc;
  }, {});

  return (
    <div className="mt-12 mb-20 bg-white/60 backdrop-blur-md p-8 rounded-xl shadow-sm border border-slate-200">
      <div className="mb-6 flex justify-between items-end">
        <div>
           <h3 className="text-2xl font-bold text-[#004a2e]" style={{ fontFamily: "'Gowun Batang', serif" }}>Analisi Priorità</h3>
           <p className="text-[#4c806c] text-sm mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Appetibilità vs. Effort</p>
        </div>
      </div>

      <div className="relative h-[400px] w-full border-l-2 border-b-2 border-slate-200" ref={chartRef}>
        {/* Y Axis Label */}
        <div
          className="absolute -left-12 top-1/2 -translate-y-1/2 -rotate-90 text-xs font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap origin-center"
          style={{ fontFamily: "'Gowun Batang', serif" }}
        >
           Appetibilità (Value)
        </div>
        {/* X Axis Label */}
        <div
          className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-400 uppercase tracking-widest"
          style={{ fontFamily: "'Gowun Batang', serif" }}
        >
           Sforzo (Effort)
        </div>

        {/* Grid Lines Y */}
        {[1, 2, 3, 4, 5].map(val => (
          <div key={`y-${val}`} className="absolute w-full border-t border-slate-100 flex items-center" style={{ bottom: `${(val - 1) * 25}%` }}>
            <span className="absolute -left-6 text-xs text-slate-400 font-mono">{val}</span>
          </div>
        ))}
        {/* Grid Lines X */}
        {[1, 2, 3, 4, 5].map(val => (
          <div key={`x-${val}`} className="absolute h-full border-r border-slate-100 flex justify-center" style={{ left: `${(val - 1) * 25}%` }}>
            <span className="absolute -bottom-6 text-xs text-slate-400 font-mono">{val}</span>
          </div>
        ))}

        {/* Plot Grouped Items */}
        {Object.values(groupedItems).map((group) => {
           return group.map((item, index) => {
              // Calculate percentage positions (1..5 scale -> 0..100%)
              const leftPct = ((item.effort - 1) / 4) * 100;
              const bottomPct = ((item.appetibility - 1) / 4) * 100;

              // Calculate collision offset
              let translateX = '-50%';
              let translateY = '50%';

              if (group.length > 1) {
                 // Arrange in a small circle if overlapping
                 const angle = (index / group.length) * 2 * Math.PI;
                 const radius = 20; // px
                 const xOff = Math.cos(angle) * radius;
                 const yOff = Math.sin(angle) * radius; // Invert Y because CSS bottom goes up

                 // Apply offset to translate
                 translateX = `calc(-50% + ${xOff}px)`;
                 translateY = `calc(50% + ${yOff}px)`;
              }

              // Calcolo gradient per il Donut Chart
              const activeColors = LEGEND_DATA
                .filter(l => item.tags && item.tags.some(t => t.startsWith(l.id + ':')))
                .map(l => l.hex);

              let backgroundStyle = {};
              if (activeColors.length === 0) {
                 backgroundStyle = { backgroundColor: '#f1f1e9', border: '2px solid #133817' };
              } else if (activeColors.length === 1) {
                 backgroundStyle = { backgroundColor: activeColors[0], border: `2px solid ${activeColors[0]}` };
              } else {
                 const segment = 100 / activeColors.length;
                 const gradientParts = activeColors.map((c, i) => `${c} ${i * segment}% ${(i + 1) * segment}%`);
                 backgroundStyle = { backgroundImage: `conic-gradient(${gradientParts.join(', ')})`, border: 'none' };
              }

              return (
                <div
                  key={item.id}
                  className="absolute group z-10 hover:z-50 transition-all duration-300"
                  style={{
                    left: `${leftPct}%`,
                    bottom: `${bottomPct}%`,
                    transform: `translate(${translateX}, ${translateY})`
                  }}
                >
                  {/* Collapsed State: DONUT TOKEN */}
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shadow-md cursor-pointer group-hover:opacity-0 transition-opacity relative z-10"
                    style={backgroundStyle}
                  >
                    {/* Inner Circle for ID */}
                    <div className="w-6 h-6 bg-[#f1f1e9] rounded-full flex items-center justify-center">
                        <span className="text-[10px] font-bold text-[#133817] font-mono leading-none">#{item.displayId}</span>
                    </div>

                    {/* Line to center if offset */}
                    {group.length > 1 && (
                      <div
                        className="absolute w-0.5 bg-slate-200 -z-10"
                        style={{
                          height: '20px',
                          top: '50%',
                          left: '50%',
                          transformOrigin: 'top center',
                          transform: `rotate(${(index / group.length) * 360 + 180}deg)`
                        }}
                      />
                    )}
                  </div>

                  {/* Expanded State: Full Card on Hover */}
                  <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50">
                     <Card
                        item={item}
                        displayId={item.displayId}
                        isActive={true}
                        onDelete={() => {}}
                        onEdit={() => {}}
                        onDragStart={(e) => e.preventDefault()}
                        onShowTooltip={() => {}}
                        onHideTooltip={() => {}}
                     />
                     {/* Little Triangle Pointer */}
                     <div className="absolute left-1/2 -bottom-2 w-4 h-4 bg-[#f1f1e9] border-b border-r border-slate-200 transform -translate-x-1/2 rotate-45"></div>
                  </div>
                </div>
              );
           });
        })}
      </div>
    </div>
  );
};


// --- MAIN APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const initRef = useRef(false);

  // Authentication Effect
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // Data Persistence (Hybrid: LocalStorage + Firestore Backup)
  useEffect(() => {
    if (!user) return;

    const itemsCollection = collection(db, 'artifacts', appId, 'public', 'data', 'matrix_items');

    const unsubscribe = onSnapshot(itemsCollection, (snapshot) => {
      if (snapshot.empty && !initRef.current) {
         initRef.current = true;
         // Try restore from LocalStorage
         const localBackup = localStorage.getItem('matrix_backup_v2');
         const itemsToRestore = localBackup ? JSON.parse(localBackup) : DEFAULT_ITEMS;

         // Push to DB
         const batch = writeBatch(db); // Use batch for cleaner restore if possible, or loop
         itemsToRestore.forEach(async (item) => {
            await addDoc(itemsCollection, { ...item, createdAt: item.createdAt || new Date().toISOString() });
         });
      } else if (!snapshot.empty) {
        const loadedItems = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        loadedItems.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));

        const itemsWithId = loadedItems.map((item, index) => ({
           ...item,
           displayId: index + 1
        }));

        setItems(itemsWithId);
        // Backup to LocalStorage
        localStorage.setItem('matrix_backup_v2', JSON.stringify(itemsWithId));
        setLoading(false);
        initRef.current = true;
      } else {
         setLoading(false);
      }
    }, (error) => {
       console.error("Firestore Error, using local backup", error);
       const localBackup = localStorage.getItem('matrix_backup_v2');
       if(localBackup) setItems(JSON.parse(localBackup));
       setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const [activeFilters, setActiveFilters] = useState(() => {
    return LEGEND_DATA.reduce((acc, category) => {
      const categoryTags = category.items.map(item => `${category.id}:${item}`);
      return [...acc, ...categoryTags];
    }, []);
  });

  const [formData, setFormData] = useState({
    content: '',
    axisX: 'consumer',
    axisY: 'nuovo',
    tags: [],
    appetibility: 0,
    effort: 0
  });

  const [editingId, setEditingId] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [tooltipState, setTooltipState] = useState({ visible: false, x: 0, y: 0, content: '' });

  const handleToggleFilterItem = (tagFullString) => {
    setActiveFilters(prev => {
      if (prev.includes(tagFullString)) {
        return prev.filter(f => f !== tagFullString);
      } else {
        return [...prev, tagFullString];
      }
    });
  };

  const handleToggleCategory = (letterId) => {
    const legendItem = LEGEND_DATA.find(l => l.id === letterId);
    if (!legendItem) return;

    const allCategoryTags = legendItem.items.map(item => `${legendItem.id}:${item}`);
    const isFullActive = allCategoryTags.every(tag => activeFilters.includes(tag));

    if (isFullActive) {
      setActiveFilters(prev => prev.filter(f => !f.startsWith(legendItem.id + ':')));
    } else {
      setActiveFilters(prev => {
        const others = prev.filter(f => !f.startsWith(legendItem.id + ':'));
        return [...others, ...allCategoryTags];
      });
    }
  };

  const handleShowTooltip = (e, content) => {
    const rect = e.target.getBoundingClientRect();
    setTooltipState({
      visible: true,
      x: rect.left + (rect.width / 2),
      y: rect.top,
      content
    });
  };

  const handleHideTooltip = () => {
    setTooltipState(prev => ({ ...prev, visible: false }));
  };

  const openNewItemForm = (prefillX = 'consumer', prefillY = 'nuovo') => {
    setFormData({ content: '', axisX: prefillX, axisY: prefillY, tags: [], appetibility: 0, effort: 0 });
    setEditingId(null);
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openEditForm = (item) => {
    setFormData({
      content: item.content,
      axisX: item.axisX,
      axisY: item.axisY,
      tags: item.tags || [],
      appetibility: item.appetibility || 0,
      effort: item.effort || 0
    });
    setEditingId(item.id);
    setIsFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    if (!formData.content.trim() || !user) return;

    const collectionRef = collection(db, 'artifacts', appId, 'public', 'data', 'matrix_items');

    if (editingId) {
      try {
        const itemRef = doc(collectionRef, editingId);
        await updateDoc(itemRef, { ...formData });
      } catch (err) {
        console.error("Error updating item", err);
      }
    } else {
      try {
        await addDoc(collectionRef, {
          ...formData,
          createdAt: new Date().toISOString()
        });
      } catch (err) {
        console.error("Error adding item", err);
      }
    }

    setFormData({ content: '', axisX: 'consumer', axisY: 'nuovo', tags: [], appetibility: 0, effort: 0 });
    setEditingId(null);
    setIsFormOpen(false);
  };

  const toggleTag = (letterId, subItem) => {
    const fullTag = `${letterId}:${subItem}`;
    setFormData(prev => {
      const currentTags = prev.tags || [];
      if (currentTags.includes(fullTag)) {
        return { ...prev, tags: currentTags.filter(t => t !== fullTag) };
      } else {
        return { ...prev, tags: [...currentTags, fullTag] };
      }
    });
  };

  const handleDeleteItem = async (id) => {
    if (!user) return;
    try {
      const itemRef = doc(db, 'artifacts', appId, 'public', 'data', 'matrix_items', id);
      await deleteDoc(itemRef);
      if (editingId === id) {
        setIsFormOpen(false);
        setEditingId(null);
      }
    } catch (err) {
      console.error("Error deleting item", err);
    }
  };

  const handleDragStart = (e, id) => {
    setDraggedItemId(id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = async (targetX, targetY) => {
    if (!draggedItemId || !user) return;

    const itemToMove = items.find(i => i.id === draggedItemId);
    if (!itemToMove) return;

    try {
      const itemRef = doc(db, 'artifacts', appId, 'public', 'data', 'matrix_items', draggedItemId);
      await updateDoc(itemRef, { axisX: targetX, axisY: targetY });
    } catch (err) {
      console.error("Error moving item", err);
    }

    setDraggedItemId(null);
  };

  const getItemsForQuadrant = (x, y) => {
    return items.filter(item => item.axisX === x && item.axisY === y);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f1f1e9]" style={{ fontFamily: "'Georama', sans-serif" }}>
        <div className="flex flex-col items-center gap-4 text-[#004a2e]">
          <Loader2 className="animate-spin w-8 h-8" />
          <p>Caricamento dati...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-900 p-4 md:p-8 relative overflow-x-hidden" style={{ fontFamily: "'Georama', sans-serif", backgroundColor: '#f1f1e9' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Georama:ital,wght@0,100..900;1,100..900&family=Gowun+Batang:wght@400;700&family=IBM+Plex+Mono:wght@400;500;700&display=swap');

        /* Updated Floating Animations */
        @keyframes wander-slow {
          0% { transform: translate(0, 0) rotate(0deg); }
          25% { transform: translate(20px, -30px) rotate(5deg); }
          50% { transform: translate(-10px, 40px) rotate(-5deg); }
          75% { transform: translate(-30px, -10px) rotate(2deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        @keyframes wander-medium {
          0% { transform: translate(0, 0) rotate(0deg); }
          33% { transform: translate(-25px, 20px) rotate(-3deg); }
          66% { transform: translate(15px, -15px) rotate(3deg); }
          100% { transform: translate(0, 0) rotate(0deg); }
        }
        @keyframes wander-fast {
          0% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(15px, 15px) scale(0.95); }
          100% { transform: translate(0, 0) scale(1); }
        }

        .animate-wander-slow { animation: wander-slow 20s ease-in-out infinite; }
        .animate-wander-medium { animation: wander-medium 15s ease-in-out infinite; }
        .animate-wander-fast { animation: wander-fast 12s ease-in-out infinite; }
      `}</style>

      {/* Background Color Solid Layer - No Blobs */}
      <div className="fixed inset-0 bg-[#f1f1e9] -z-20" />
      <BackgroundDecorations />

      <Tooltip
        visible={tooltipState.visible}
        x={tooltipState.x}
        y={tooltipState.y}
        content={tooltipState.content}
      />

      <div className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative z-10">
        <div>
          <h1 className="text-3xl font-bold text-[#004a2e]" style={{ fontFamily: "'Gowun Batang', serif" }}>Use Cases PMAAS</h1>
          <p className="text-[#4c806c] mt-1" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>Matrice Strategica</p>
        </div>

        <button
          onClick={() => isFormOpen ? setIsFormOpen(false) : openNewItemForm()}
          className="text-white px-6 py-2.5 rounded-full font-medium flex items-center gap-2 transition-all shadow-sm hover:shadow-lg hover:-translate-y-0.5"
          style={{
            background: `
              radial-gradient(circle, rgba(255, 255, 255, 0.4) 1px, transparent 1px) 0 0 / 4px 4px,
              linear-gradient(90deg, #f684b8, #e74613)
            `,
            textShadow: '0 1px 2px rgba(0,0,0,0.2)',
            fontFamily: "'Gowun Batang', serif"
          }}
        >
          {isFormOpen ? <X size={20} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }} /> : <Plus size={20} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }} />}
          {isFormOpen ? 'Chiudi' : 'Nuovo Elemento'}
        </button>
      </div>

      {isFormOpen && (
        <div className="max-w-2xl mx-auto mb-8 bg-[#f1f1e9] p-6 rounded-xl shadow-xl border-2 border-[#4c806c] animate-in slide-in-from-top-4 duration-300 relative z-20">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-[#004a2e]" style={{ fontFamily: "'Gowun Batang', serif" }}>
              {editingId ? 'Modifica Iniziativa' : 'Nuova Iniziativa'}
            </h2>
            {editingId && (
              <span
                className="text-xs bg-[#ee7630] text-white px-2 py-1 rounded font-medium"
                style={{ fontFamily: "'IBM Plex Mono', monospace" }}
              >
                Modifica in corso
              </span>
            )}
          </div>

          <form onSubmit={handleSaveItem} className="space-y-5">
            <div className="space-y-4">
              <div>
                <label
                  className="block text-xs font-bold text-[#133817] uppercase tracking-wider mb-2"
                  style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  Descrizione
                </label>
                <input
                  type="text"
                  value={formData.content}
                  onChange={(e) => setFormData({...formData, content: e.target.value})}
                  placeholder="Es. Sviluppo chatbot..."
                  className="w-full px-4 py-2 bg-[#f1f1e9] border-2 border-[#4c806c] text-[#133817] rounded-lg focus:ring-2 focus:ring-[#133817] focus:border-[#133817] outline-none transition-all placeholder:text-slate-400"
                  autoFocus
                />
              </div>

              {/* Parametri di Valutazione */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Appetibilità (Stars) */}
                <div>
                  <label
                    className="block text-xs font-bold text-[#133817] uppercase tracking-wider mb-2"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    Appetibilità
                  </label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        onClick={() => setFormData({ ...formData, appetibility: star })}
                        className="focus:outline-none transition-transform hover:scale-110 active:scale-95 group/star"
                      >
                        <Star
                          size={28}
                          className={`transition-colors duration-200 ${
                            star <= formData.appetibility
                              ? "fill-[#ee7630] text-[#ee7630]"
                              : "text-[#4c806c]/30 hover:text-[#ee7630]/60"
                          }`}
                          strokeWidth={star <= formData.appetibility ? 0 : 2}
                        />
                      </button>
                    ))}
                    {formData.appetibility > 0 && (
                      <span
                        className="ml-2 text-xs font-medium text-[#ee7630] animate-in fade-in slide-in-from-left-2 duration-300"
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {getAppetibilityLabel(formData.appetibility)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Effort (Hammers) */}
                <div>
                  <label
                    className="block text-xs font-bold text-[#133817] uppercase tracking-wider mb-2"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    Effort
                  </label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((hammer) => (
                      <button
                        key={hammer}
                        type="button"
                        onClick={() => setFormData({ ...formData, effort: hammer })}
                        className="focus:outline-none transition-transform hover:scale-110 active:scale-95 group/hammer"
                      >
                        <Hammer
                          size={28}
                          className={`transition-colors duration-200 ${
                            hammer <= formData.effort
                              ? "fill-[#e06666] text-[#e06666]"
                              : "text-[#4c806c]/30 hover:text-[#e06666]/60"
                          }`}
                          strokeWidth={hammer <= formData.effort ? 0 : 2}
                        />
                      </button>
                    ))}
                    {formData.effort > 0 && (
                      <span
                        className="ml-2 text-xs font-medium text-[#e06666] animate-in fade-in slide-in-from-left-2 duration-300"
                        style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                      >
                        {getEffortLabel(formData.effort)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-4">
                <div>
                  <label
                    className="block text-xs font-bold text-[#133817] uppercase tracking-wider mb-2"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    Target (X)
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, axisX: 'consumer'})}
                      className={`flex-1 py-2 px-3 text-sm rounded-md border-2 transition-all ${
                        formData.axisX === 'consumer'
                          ? 'bg-[#4c806c] border-[#4c806c] text-[#f1f1e9] font-medium'
                          : 'bg-[#f1f1e9] border-[#4c806c] text-[#4c806c] hover:bg-[#ccdad5]'
                      }`}
                    >
                      Consumer
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, axisX: 'internal'})}
                      className={`flex-1 py-2 px-3 text-sm rounded-md border-2 transition-all ${
                        formData.axisX === 'internal'
                          ? 'bg-[#4c806c] border-[#4c806c] text-[#f1f1e9] font-medium'
                          : 'bg-[#f1f1e9] border-[#4c806c] text-[#4c806c] hover:bg-[#ccdad5]'
                      }`}
                    >
                      Internal
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    className="block text-xs font-bold text-[#133817] uppercase tracking-wider mb-2"
                    style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                  >
                    Stato (Y)
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, axisY: 'nuovo'})}
                      className={`flex-1 py-2 px-3 text-sm rounded-md border-2 transition-all ${
                        formData.axisY === 'nuovo'
                          ? 'bg-[#4c806c] border-[#4c806c] text-[#f1f1e9] font-medium'
                          : 'bg-[#f1f1e9] border-[#4c806c] text-[#4c806c] hover:bg-[#ccdad5]'
                      }`}
                    >
                      New
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({...formData, axisY: 'esistente'})}
                      className={`flex-1 py-2 px-3 text-sm rounded-md border-2 transition-all ${
                        formData.axisY === 'esistente'
                          ? 'bg-[#4c806c] border-[#4c806c] text-[#f1f1e9] font-medium'
                          : 'bg-[#f1f1e9] border-[#4c806c] text-[#4c806c] hover:bg-[#ccdad5]'
                      }`}
                    >
                      Existing
                    </button>
                  </div>
                </div>
              </div>

              <div className="md:col-span-2">
                <label
                  className="block text-xs font-bold text-[#133817] uppercase tracking-wider mb-2"
                  style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  Tags Strategici (Multiselezione)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#f1f1e9] p-4 rounded-lg border-2 border-[#4c806c]">
                  {LEGEND_DATA.map((tag) => (
                    <div key={tag.id} className="space-y-2">
                      <div className={`flex items-center gap-2 font-bold ${tag.text}`}>
                        <span className={`w-2 h-2 rounded-full ${tag.color}`}></span>
                        {tag.letter} - {tag.label}
                      </div>
                      <div className="pl-4 space-y-1">
                        {tag.items.map((subItem, idx) => {
                          const fullTagString = `${tag.id}:${subItem}`;
                          const isSelected = formData.tags.includes(fullTagString);
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => toggleTag(tag.id, subItem)}
                              className={`
                                w-full text-left text-xs py-1.5 px-2 rounded transition-colors flex items-center justify-between
                                ${isSelected
                                  ? 'bg-[#133817] text-[#f1f1e9] font-medium shadow-sm'
                                  : 'text-[#133817] hover:bg-[#ccdad5] hover:text-[#133817]'}
                              `}
                            >
                              <span>{subItem}</span>
                              {isSelected && <Check size={12} className="text-[#f1f1e9]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="submit"
              className="w-full text-white py-3 rounded-full font-medium transition-all shadow-sm hover:shadow-lg hover:-translate-y-0.5 mt-4"
              style={{
                background: `
                  radial-gradient(circle, rgba(255, 255, 255, 0.4) 1px, transparent 1px) 0 0 / 4px 4px,
                  linear-gradient(90deg, #f684b8, #e74613)
                `,
                textShadow: '0 1px 2px rgba(0,0,0,0.2)',
                fontFamily: "'Gowun Batang', serif"
              }}
            >
              {editingId ? 'Salva Modifiche' : 'Aggiungi alla Matrice'}
            </button>
          </form>
        </div>
      )}

      <div className="relative max-w-7xl mx-auto mb-6 z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          {LEGEND_DATA.map((data, index) => (
            <LegendBox
              key={index}
              data={data}
              activeFilters={activeFilters}
              onToggleCategory={handleToggleCategory}
              onToggleFilterItem={handleToggleFilterItem}
            />
          ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto z-10">
        <div className="flex flex-col gap-4 md:grid md:grid-cols-[30px_1fr_1fr] md:grid-rows-[30px_minmax(0,1fr)_minmax(0,1fr)] md:gap-2 md:h-[calc(100vh-320px)] md:min-h-[600px]">

          <div className="hidden md:block"></div>

          <div className="hidden md:flex items-end justify-center pb-1">
            <span className="font-extrabold text-[#4c806c] tracking-[0.2em] text-sm" style={{ fontFamily: "'Gowun Batang', serif" }}>CONSUMER</span>
          </div>
          <div className="hidden md:flex items-end justify-center pb-1">
            <span className="font-extrabold text-[#4c806c] tracking-[0.2em] text-sm" style={{ fontFamily: "'Gowun Batang', serif" }}>INTERNAL</span>
          </div>

          <div className="hidden md:flex items-center justify-center writing-vertical rotate-180">
            <span className="font-extrabold text-[#4c806c] tracking-[0.2em] text-sm rotate-90" style={{ fontFamily: "'Gowun Batang', serif" }}>NEW</span>
          </div>

          <Quadrant
            title="Innovazione di Prodotto"
            subtitle="Nuove offerte per i clienti"
            items={getItemsForQuadrant('consumer', 'nuovo')}
            activeFilters={activeFilters}
            typeX="consumer"
            typeY="nuovo"
            bgColor="bg-[#ccdad5]"
            borderColor="border-[#4c806c]"
            onDrop={handleDrop}
            onDelete={handleDeleteItem}
            onEdit={openEditForm}
            onAdd={openNewItemForm}
            onDragStart={handleDragStart}
            onShowTooltip={handleShowTooltip}
            onHideTooltip={handleHideTooltip}
          />

          <Quadrant
            title="Innovazione Operativa"
            subtitle="Nuovi strumenti interni"
            items={getItemsForQuadrant('internal', 'nuovo')}
            activeFilters={activeFilters}
            typeX="internal"
            typeY="nuovo"
            bgColor="bg-[#ccdad5]"
            borderColor="border-[#4c806c]"
            onDrop={handleDrop}
            onDelete={handleDeleteItem}
            onEdit={openEditForm}
            onAdd={openNewItemForm}
            onDragStart={handleDragStart}
            onShowTooltip={handleShowTooltip}
            onHideTooltip={handleHideTooltip}
          />

          <div className="hidden md:flex items-center justify-center writing-vertical rotate-180">
            <span className="font-extrabold text-[#4c806c] tracking-[0.2em] text-sm rotate-90" style={{ fontFamily: "'Gowun Batang', serif" }}>EXISTING</span>
          </div>

          <Quadrant
            title="Customer Experience"
            subtitle="Miglioramento servizi attuali"
            items={getItemsForQuadrant('consumer', 'esistente')}
            activeFilters={activeFilters}
            typeX="consumer"
            typeY="esistente"
            bgColor="bg-[#ccdad5]"
            borderColor="border-[#4c806c]"
            onDrop={handleDrop}
            onDelete={handleDeleteItem}
            onEdit={openEditForm}
            onAdd={openNewItemForm}
            onDragStart={handleDragStart}
            onShowTooltip={handleShowTooltip}
            onHideTooltip={handleHideTooltip}
          />

          <Quadrant
            title="Efficienza & Ottimizzazione"
            subtitle="Miglioramento processi attuali"
            items={getItemsForQuadrant('internal', 'esistente')}
            activeFilters={activeFilters}
            typeX="internal"
            typeY="esistente"
            bgColor="bg-[#ccdad5]"
            borderColor="border-[#4c806c]"
            onDrop={handleDrop}
            onDelete={handleDeleteItem}
            onEdit={openEditForm}
            onAdd={openNewItemForm}
            onDragStart={handleDragStart}
            onShowTooltip={handleShowTooltip}
            onHideTooltip={handleHideTooltip}
          />

        </div>

        <div className="md:hidden mt-8 p-4 bg-yellow-50 rounded-lg text-xs text-yellow-800 flex items-start gap-2">
          <Info size={16} className="shrink-0 mt-0.5" />
          <p>Su schermi piccoli, i quadranti sono impilati. Scorri per vedere tutte le categorie.</p>
        </div>
      </div>

      {/* NEW: Analysis Chart Section */}
      <div className="max-w-7xl mx-auto z-10 relative">
        <EffortValueChart items={items} />
      </div>

    </div>
  );
}
