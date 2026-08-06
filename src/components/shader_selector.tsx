//shader_selector.tsx
import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { modalManager } from '../state/modalManager';
import DraggableModal from './DraggableModal';

// Shader icon - star/reflective glass vibes
const shaderIcon: string = 'M12 2L9.19 8.63 2 9.24l5.46 4.73L6.82 21 12 17.27 17.18 21l-.64-7.26L22 9.24l-7.19-.61z';

// Scan src/shaders folder for available shaders
async function getAvailableShaders(): Promise<string[]> {
  try {
    // Try to get shader list from window globals (set by main process)
    const availableShaders = (window as any).__availableShaders;
    if (Array.isArray(availableShaders) && availableShaders.length > 0) {
      console.log('[ShaderSelector] Found shaders from window globals:', availableShaders);
      return availableShaders;
    }
    
    // Use Vite's import.meta.glob to dynamically scan the src/shaders directory
    // This finds all folders that have an index.ts file
    try {
      const shaderModules = import.meta.glob('/src/shaders/*/index.ts', { eager: false });
      const shaderNames = Object.keys(shaderModules)
        .map(path => {
          // Extract shader name from path like "/src/shaders/default_shader/index.ts"
          const match = path.match(/\/src\/shaders\/([^/]+)\/index\.ts/);
          return match ? match[1] : null;
        })
        .filter((name): name is string => name !== null);
      
      console.log('[ShaderSelector] Found shaders from glob:', shaderNames);
      
      if (shaderNames.length > 0) {
        return shaderNames;
      }
    } catch (globError) {
      console.warn('[ShaderSelector] Glob scan failed:', globError);
    }
    
    // Fallback: return known shaders
    console.log('[ShaderSelector] Using fallback shader list');
    return ['default_shader', 'shader2'];
  } catch {
    return ['default_shader'];
  }
}

export function OpenShaderSelector(onCloseCallback?: () => void) {
  const result = modalManager.requestOpen('shaderSelector');
  if (!result.allowed) {
    alert('Opening multiple menus is disabled!');
    return;
  }
  
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  
  const closeDirectly = () => {
    try { root.unmount(); } catch (e) {}
    if (container.parentNode) container.parentNode.removeChild(container);
    (window as any).__popClose?.();
    modalManager.close('shaderSelector');
  };
  
  (window as any).__pushClose?.(closeDirectly);
  root.render(<ShaderSelectorModal onClose={closeDirectly} />);
  
  if (onCloseCallback) {
    onCloseCallback();
  }
  
  return closeDirectly;
}

export default function ShaderSelectorModal({ onClose }: { onClose: () => void }) {
  const [activeShader, setActiveShader] = useState<string>(() => {
    try {
      return window.localStorage.getItem('juicecut.shaders.active') || 'default_shader';
    } catch {
      return 'default_shader';
    }
  });
  const [shaders, setShaders] = useState<string[]>([]);

  useEffect(() => {
    // Load available shaders
    let cancelled = false;
    getAvailableShaders().then(shaderList => {
      if (!cancelled) {
        setShaders(shaderList);
      }
    });
    
    // Listen for shader list updates
    const handler = () => {
      getAvailableShaders().then(shaderList => {
        if (!cancelled) {
          setShaders(shaderList);
        }
      });
    };
    window.addEventListener('juicecut-shaders-updated', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('juicecut-shaders-updated', handler);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('juicecut.shaders.active', activeShader);
    } catch {}
  }, [activeShader]);

  const handleShaderSelect = (shaderName: string) => {
    setActiveShader(shaderName);
    // Dispatch event to notify main process to switch shader
    window.dispatchEvent(new CustomEvent('juicecut-shader-change', { detail: { shaderName } }));
  };

  return (
    <DraggableModal
      title="Shaders"
      onClose={() => {
        modalManager.close('shaderSelector');
        onClose();
      }}
      className="settings-modal"
      style={{ width: '480px', height: '72vh', minHeight: '72vh', maxHeight: '72vh', overflow: 'hidden' }}
      persistenceKey="shaderSelector"
      body={
        <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 90px)', gap: '8px 12px', alignItems: 'flex-start', justifyContent: 'flex-start' }}>
          {shaders.map(shaderName => {
            const isActive = activeShader === shaderName;
            const displayName = shaderName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            
            return (
              <button
                key={shaderName}
                onClick={() => handleShaderSelect(shaderName)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  background: isActive ? 'rgba(52, 211, 153, 0.2)' : 'transparent',
                  border: isActive ? '1px solid var(--accent-green)' : '1px solid transparent',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  cursor: 'pointer',
                  color: isActive ? 'var(--accent-green)' : 'var(--text-secondary)',
                  width: 90,
                  height: 100,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }
                }}
              >
                <svg
                  width="36"
                  height="36"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={isActive ? 'var(--accent-green)' : 'var(--text-secondary)'}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ opacity: isActive ? 1 : 0.7, flexShrink: 0 }}
                >
                  <path d={shaderIcon}></path>
                </svg>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.5px',
                    color: isActive ? 'var(--accent-green)' : 'var(--text-secondary)',
                    textAlign: 'center',
                  }}
                >
                  {displayName}
                </span>
              </button>
            );
          })}
        </div>
      }
    />
  );
}