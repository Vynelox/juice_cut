import { useState, useEffect, useRef } from 'react';
import { modalManager } from '../state/modalManager';
// Modal dimensions for the Styles page
const MODAL_WIDTH = '480px'; //default 480px
const MODAL_HEIGHT = '72vh';


import { OpenColorPicker } from './ColorPicker';
import { colorFields, type ThemeColors, type ColorVarName } from './GlobalStyleSettings';
import { themesByName } from './ThemeColors';
import DraggableModal from './DraggableModal';
import { RotateCcw } from 'lucide-react';

function normalizeColor(raw: string) {
  if (!raw) return '#000000';
  const v = raw.trim();
  if (v.startsWith('#')) {
    if (v.length === 4) return '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return v;
  }
  if (v.startsWith('rgb')) {
    const nums = v.replace(/rgba?\(|\)/g, '').split(',').map(s => Number(s.trim()));
    return '#' + nums.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');
  }
  return '#000000';
}

const folderIcon: string = 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2z';
const ogDarkIcon: string = 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z';
const ogLightIcon: string = 'M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z';
const monokaiIcon: string = 'm8 6-6 6 6 6M16 6l6 6-6 6';
const lavenderIcon: string = 'M12 22V8M9 11l3-3 3 3M10 11c0 1 1 2 2 2s2-1 2-2M10 8c0 1 1 2 2 2s2-1 2-2M9 5c0 1 1 2 3 2s3-1 3-2M11 14c0-1 1-2 1-3s-1-2-1-3M13 14c0-1-1-2-1-3s1-2 1-3';
const cyberpunkIcon: string = 'M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3M6 6h12v12H6zM10 10h4v4h-4z';
const oakIcon: string = 'M5 8a7 3 0 0 1 14 0v10a7 3 0 0 1-14 0V8zM8 8a4 1.5 0 0 1 8 0 4 1.5 0 0 1-8 0zM10 8a2 0.7 0 0 1 4 0 2 0.7 0 0 1-4 0z';
const forestIcon: string = 'M12 2L6 10h3l-4 6h3l-3 5h14l-3-5h3l-4-6h3L12 2zM10 21h4';

interface DisplayItem {
  id: string;
  label: string;
  type: 'theme' | 'folder';
  icon: string;
  children?: string[];
}

const topLevelItems: string[] = ['vynelox-built-in-folder'];

const allDisplayItems: Record<string, DisplayItem> = {
  'vynelox-built-in-folder': { id: 'vynelox-built-in-folder', label: 'By Vynelox', type: 'folder', icon: folderIcon, children: ['og-dark', 'og-light', 'monokai', 'lavender', 'cyberpunk', 'oak', 'forest', 'aquatic'] },
  'og-dark': { id: 'og-dark', label: 'og dark', type: 'theme', icon: ogDarkIcon },
  'og-light': { id: 'og-light', label: 'og light', type: 'theme', icon: ogLightIcon },
  'monokai': { id: 'monokai', label: 'monokai', type: 'theme', icon: monokaiIcon },
  'lavender': { id: 'lavender', label: 'lavender', type: 'theme', icon: lavenderIcon },
  'cyberpunk': { id: 'cyberpunk', label: 'cyberpunk', type: 'theme', icon: cyberpunkIcon },
  'oak': { id: 'oak', label: 'oak', type: 'theme', icon: oakIcon },
  'forest': { id: 'forest', label: 'forest', type: 'theme', icon: forestIcon },
  'aquatic': { id: 'aquatic', label: 'aquatic', type: 'theme', icon: 'M12 12c0-4 3-7 7-7s7 3 7 7-3 7-7 7-7-3-7-7zm-5 0c0-2.5 2-4.5 4.5-4.5S11 9.5 11 12s-2 4.5-4.5 4.5S2 14.5 2 12zm10 0c0-1.5 1-3 3-3s3 1.5 3 3-1 3-3 3-3-1.5-3-3z' },
};

export const parentMap: Record<string, string | undefined> = {
  'og-dark': 'vynelox-built-in-folder',
  'og-light': 'vynelox-built-in-folder',
  'monokai': 'vynelox-built-in-folder',
  'lavender': 'vynelox-built-in-folder',
  'cyberpunk': 'vynelox-built-in-folder',
  'oak': 'vynelox-built-in-folder',
  'forest': 'vynelox-built-in-folder',
  'aquatic': 'vynelox-built-in-folder',
};

function getPathLabel(itemId: string | null): string {
  if (!itemId) return 'Styles';
  const path: string[] = [];
  let currentId: string | undefined = itemId;
  while (currentId) {
    const item = allDisplayItems[currentId];
    if (item) { path.unshift(item.label); currentId = parentMap[currentId]; } else { break; }
  }
  const fullPath = 'Styles / ' + path.join(' / ');
  
  // If the path is too long, truncate the beginning with ellipsis
  if (fullPath.length > 40) {
    return '.../' + path.slice(-2).join(' / ');
  }
  return fullPath;
}

function getThemeColors(themeName: string): ThemeColors {
  return themesByName[themeName] ?? themesByName['og-dark'];
}

export function applyThemeToDocument(themeName: string) {
  const themeColors = getThemeColors(themeName);
  colorFields.forEach(c => { document.documentElement.style.setProperty(c.varName, themeColors[c.varName]); });
}

export function StylesContent({ themeName, setShowStyle, setStylePage }: {
  themeName: string;
  setShowStyle: (v: boolean) => void;
  setStylePage: (v: string | null) => void;
}) {
  const [colors, setColors] = useState<Record<string, string>>(() => {
    const styles = getComputedStyle(document.documentElement);
    const initial: Record<string, string> = {};
    colorFields.forEach(c => { initial[c.varName] = normalizeColor(styles.getPropertyValue(c.varName).trim() || '#000000'); });
    return initial;
  });
  const prevThemeRef = useRef(themeName);

  // Only reset colors when the theme actually changes, not on re-mount
  useEffect(() => {
    if (prevThemeRef.current !== themeName) {
      prevThemeRef.current = themeName;
      applyThemeToDocument(themeName);
      setColors({ ...getThemeColors(themeName) });
    }
  }, [themeName]);

  function updateColor(varName: string, hex: string) {
    document.documentElement.style.setProperty(varName, hex);
    setColors(prev => ({ ...prev, [varName]: hex }));
  }

  function resetColor(varName: ColorVarName) {
    const defaultColor = getThemeColors(themeName)[varName];
    document.documentElement.style.setProperty(varName, defaultColor);
    setColors(prev => ({ ...prev, [varName]: defaultColor }));
  }

  function handleColorClick(varName: string, currentValue: string) {
    const colorField = colorFields.find(c => c.varName === varName);
    const colorLabel = colorField ? colorField.label : 'Color';
    setShowStyle(false);
    const cleanup = OpenColorPicker({ value: currentValue, onChange: (hex: string) => updateColor(varName, hex), targetElement: colorLabel });
    (window as any).__onColorPickerClose = () => { setShowStyle(true); setStylePage(themeName); };
    (window as any).__colorPickerCleanup = () => { cleanup(); if ((window as any).__onColorPickerClose) { (window as any).__onColorPickerClose(); (window as any).__onColorPickerClose = null; } };
  }

  const defaultColors = getThemeColors(themeName);

  return (
    <div style={{ flex: 1, padding: 12, overflow: 'auto' }}>
      <div className="appearance-plain">
        {colorFields.map(field => {
          const isCustom = colors[field.varName] !== defaultColors[field.varName];
          return (
            <div key={field.varName} className="color-field">
              <div className="color-label">{field.label}</div>
              <div className="color-controls">
                <button type="button" className="color-swatch" style={{ backgroundColor: colors[field.varName] || '#000000' }} onClick={() => handleColorClick(field.varName, colors[field.varName] || '#000000')} title="Click to pick a color" />
                {isCustom && (
                  <button type="button" className="icon-btn" onClick={() => resetColor(field.varName)} title="Reset to default" style={{ width: 24, height: 24, color: 'var(--text-muted)' }}>
                    <RotateCcw size={12} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StylesModal({ showStyle, setShowStyle, stylePage, setStylePage }: {
  showStyle: boolean;
  setShowStyle: (v: boolean) => void;
  stylePage: string | null;
  setStylePage: (v: string | null) => void;
}) {
  const [activeTheme, setActiveTheme] = useState<string>(() => {
    try { return window.localStorage.getItem('juicecut.styles.activeTheme') || 'og-dark'; } catch { return 'og-dark'; }
  });
  const [themePage, setThemePage] = useState<string | null>(stylePage);

  useEffect(() => { setThemePage(stylePage); }, [stylePage]);
  useEffect(() => { try { window.localStorage.setItem('juicecut.styles.activeTheme', activeTheme); } catch {} }, [activeTheme]);

  if (!showStyle) return null;

  return (
    <DraggableModal
      title={getPathLabel(stylePage)}
      onClose={() => { modalManager.close('styles'); setShowStyle(false);}}
      className="settings-modal"
      style={{ width: MODAL_WIDTH, height: MODAL_HEIGHT, minHeight: MODAL_HEIGHT, maxHeight: MODAL_HEIGHT, overflow: 'hidden' }}
      persistenceKey="styles"
      pageState={{ stylePage, activeTheme }}
      onSavePageState={(state) => {}}
      onRestorePageState={(state) => {
        if (state) {
          if (state.stylePage !== undefined) setStylePage(state.stylePage);
          if (state.activeTheme) setActiveTheme(state.activeTheme);
        }
      }}
      headerLeft={stylePage && (
        <button className="icon-btn" onClick={() => { const parentId = parentMap[stylePage]; setStylePage(parentId || null); }} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 26, height: 26, color: 'var(--text-secondary)' }} title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/>
            <polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
      )}
      body={
        <>
          {!stylePage && (
            <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 90px)', gap: '8px 12px', alignItems: 'flex-start', justifyContent: 'flex-start' }}>
              {topLevelItems.map(itemId => {
                const item = allDisplayItems[itemId];
                if (!item) return null;
                return (
                  <button key={item.id} onClick={() => setStylePage(item.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'transparent', border: 'none', borderRadius: 'var(--radius-md)', padding: '12px 16px', cursor: 'pointer', color: 'var(--text-secondary)', width: 90, height: 100, flexShrink: 0 }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                      <path d={item.icon}></path>
                    </svg>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', textAlign: 'center' }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {stylePage && allDisplayItems[stylePage]?.type === 'folder' && (
            <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 90px)', gap: '4px 12px', alignItems: 'start', alignContent: 'start', justifyContent: 'start' }}>
              {allDisplayItems[stylePage].children?.map(childId => {
                const childItem = allDisplayItems[childId];
                if (!childItem) return null;
                const isActive = activeTheme === childItem.id;
                return (
                  <button key={childItem.id} onClick={() => { if (childItem.type === 'folder') { setStylePage(childItem.id); } else { if (activeTheme === childItem.id) { setStylePage(childItem.id); setThemePage(childItem.id); } else { setActiveTheme(childItem.id); applyThemeToDocument(childItem.id); } } }} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: isActive ? 'rgba(52, 211, 153, 0.2)' : 'transparent', border: isActive ? '1px solid var(--accent-green)' : '1px solid transparent', borderRadius: 'var(--radius-md)', padding: '12px 16px', cursor: 'pointer', color: isActive ? 'var(--accent-green)' : 'var(--text-secondary)', width: 90, height: 100, flexShrink: 0 }} onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }} onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={isActive ? 'var(--accent-green)' : 'var(--text-secondary)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: isActive ? 1 : 0.7, flexShrink: 0 }}>
                      <path d={childItem.icon}></path>
                    </svg>
                    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', color: isActive ? 'var(--accent-green)' : 'var(--text-secondary)', textAlign: 'center' }}>{childItem.label}</span>
                  </button>
                );
              })}
            </div>
          )}
          {stylePage && allDisplayItems[stylePage]?.type === 'theme' && (
            <StylesContent themeName={stylePage} setShowStyle={setShowStyle} setStylePage={setStylePage} />
          )}
        </>
      }
    />
  );
}