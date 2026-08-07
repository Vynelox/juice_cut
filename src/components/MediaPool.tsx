import { useCallback, useRef, useState } from 'react';
import { Film, Music, Image as ImageIcon, Trash2, List, Layout } from 'lucide-react';
import type { MediaItem } from '../types';

interface Props {
  items: MediaItem[];
  selectedMediaId: string | null;
  onSelect: (id: string) => void;
  onAdd: (files: FileList) => void;
  onRemove: (id: string) => void;
}

export default function MediaPool({ items, selectedMediaId, onSelect, onAdd, onRemove }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<'list' | 'icon'>('list');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      onAdd(e.target.files);
      e.target.value = '';
    }
  };

  const TypeIcon = ({ type }: { type: MediaItem['type'] }) => {
    if (type === 'video') return <Film size={14} className="text-blue-400" />;
    if (type === 'audio') return <Music size={14} className="text-green-400" />;
    return <ImageIcon size={14} className="text-amber-400" />;
  };

  const formatDur = (frames: number) => `${(frames / 30).toFixed(1)}s`;

  // Create drag preview element
  const createDragPreview = (item: MediaItem): HTMLElement => {
    const preview = document.createElement('div');
    preview.style.cssText = `
      position: absolute;
      pointer-events: none;
      z-index: 9999;
      width: 160px;
      height: 90px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-mid);
      border-radius: var(--radius-md);
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 11px;
      color: var(--text-primary);
    `;
    
    // Thumbnail area
    const thumbArea = document.createElement('div');
    thumbArea.style.cssText = `
      width: 100%;
      height: 64px;
      background: ${item.thumbnail ? `url(${item.thumbnail}) center/cover` : 'var(--bg-panel)'};
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    if (!item.thumbnail) {
      const icon = document.createElement('div');
      icon.style.cssText = `
        width: 28px;
        height: 28px;
        color: ${item.type === 'audio' ? 'var(--accent-green)' : 'var(--accent-amber)'};
      `;
      // Simple SVG icon
      if (item.type === 'audio') {
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style="width:100%;height:100%"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';
      } else {
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style="width:100%;height:100%"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>';
      }
      thumbArea.appendChild(icon);
    }
    
    // Info area
    const infoArea = document.createElement('div');
    infoArea.style.cssText = `
      padding: 4px 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--bg-panel);
      border-top: 1px solid var(--border-mid);
    `;
    
    const typeIcon = document.createElement('span');
    typeIcon.style.cssText = `color: ${item.type === 'audio' ? 'var(--accent-green)' : item.type === 'video' ? 'var(--accent-amber)' : 'var(--accent-rose)'};`;
    typeIcon.textContent = item.type === 'audio' ? '♪' : item.type === 'video' ? '▶' : '🖼';
    
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = `
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 500;
    `;
    nameSpan.textContent = item.name;
    
    const durSpan = document.createElement('span');
    durSpan.style.cssText = `
      font-size: 10px;
      color: var(--text-muted);
      background: var(--bg-base);
      padding: 1px 4px;
      border-radius: 2px;
    `;
    durSpan.textContent = `${(item.duration / 30).toFixed(1)}s`;
    
    infoArea.appendChild(typeIcon);
    infoArea.appendChild(nameSpan);
    infoArea.appendChild(durSpan);
    
    preview.appendChild(thumbArea);
    preview.appendChild(infoArea);
    
    return preview;
  };
  
  // View mode toggle button
  const ViewModeButton = () => (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setViewMode(prev => prev === 'list' ? 'icon' : 'list')}
      title={`Switch to ${viewMode === 'list' ? 'icon' : 'list'} mode`}
      style={{ marginLeft: 'auto' }}
    >
      {viewMode === 'list' ? (
        <Layout size={16} />
      ) : (
        <List size={16} />
      )}
    </button>
  );

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        accept=".mp4,.mp3,.png,.jpg,.jpeg,.mkv,.mov,.avif,.webm,.ogg"
        multiple
        hidden
        onChange={handleFileChange}
      />
      <div className="media-list">
        {/* Header with view mode toggle */}
        <div className="media-header" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '4px 8px',
          marginBottom: '4px',
          borderBottom: '1px solid var(--border-mid)'
        }}>
          <span className="panel-title" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Media Pool ({items.length})
          </span>
          <ViewModeButton />
        </div>
        
        {items.length === 0 && (
          <div 
            className="empty-drop" 
            onClick={() => fileInputRef.current?.click()}
            style={{ cursor: 'pointer', padding: '24px', textAlign: 'center' }}
          >
            <Film size={28} style={{ color: 'var(--text-secondary)', marginBottom: '8px' }} />
            <p>Drop media here or click me</p>
          </div>
        )}
        
        {viewMode === 'list' ? (
          // List view
          <div className="media-list" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            {items.map(item => (
              <div
                key={item.id}
                className={`media-item${selectedMediaId === item.id ? ' selected' : ''}`}
                onClick={() => onSelect(item.id)}
                draggable={true}
                onDragStart={(e: React.DragEvent<HTMLDivElement>) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('text/plain', item.id);
                  
                  // Create custom drag preview
                  const dragPreview = createDragPreview(item);
                  document.body.appendChild(dragPreview);
                  
                  // Position it at cursor using native event
                  const nativeEvent = e.nativeEvent;
                  const updatePosition = (ev: MouseEvent) => {
                    dragPreview.style.left = `${ev.clientX + 12}px`;
                    dragPreview.style.top = `${ev.clientY + 12}px`;
                  };
                  
                  updatePosition(nativeEvent);
                  
                  // Use a tiny transparent element as the native drag image
                  // so our custom element can follow the cursor
                  const transparentImg = new Image();
                  transparentImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                  e.dataTransfer.setDragImage(transparentImg, 0, 0);
                  
                  // Clean up after drag ends
                  const cleanup = () => {
                    document.removeEventListener('mousemove', updatePosition);
                    document.removeEventListener('dragend', cleanup);
                    // Note: dragleave fires immediately when leaving source element, so don't use it
                    if (dragPreview.parentNode) {
                      dragPreview.parentNode.removeChild(dragPreview);
                    }
                  };
                  
                  document.addEventListener('mousemove', updatePosition);
                  document.addEventListener('dragend', cleanup);
                }}
              >
                <div className="media-thumb">
                  {item.thumbnail
                    ? <img src={item.thumbnail} alt={item.name} />
                    : item.type === 'audio'
                      ? <Music size={22} className="text-green-400" />
                      : <Film size={22} className="text-blue-400" />
                  }
                </div>
                <div className="media-info">
                  <div className="media-name" title={item.name}>{item.name}</div>
                  <div className="media-meta">
                    <TypeIcon type={item.type} />
                    <span>{formatDur(item.duration)}</span>
                  </div>
                </div>
                <button
                  className="media-remove"
                  onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          // Icon/Grid view
          <div className="media-grid" style={{ 
            flex: 1, 
            overflow: 'auto', 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '8px',
            padding: '4px'
          }}>
            {items.map(item => (
              <div
                key={item.id}
                className={`media-item${selectedMediaId === item.id ? ' selected' : ''}`}
                onClick={() => onSelect(item.id)}
                draggable={true}
                onDragStart={(e: React.DragEvent<HTMLDivElement>) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('text/plain', item.id);
                  
                  // Create custom drag preview
                  const dragPreview = createDragPreview(item);
                  document.body.appendChild(dragPreview);
                  
                  // Position it at cursor using native event
                  const nativeEvent = e.nativeEvent;
                  const updatePosition = (ev: MouseEvent) => {
                    dragPreview.style.left = `${ev.clientX + 12}px`;
                    dragPreview.style.top = `${ev.clientY + 12}px`;
                  };
                  
                  updatePosition(nativeEvent);
                  
                  // Use a tiny transparent element as the native drag image
                  // so our custom element can follow the cursor
                  const transparentImg = new Image();
                  transparentImg.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                  e.dataTransfer.setDragImage(transparentImg, 0, 0);
                  
                  // Clean up after drag ends
                  const cleanup = () => {
                    document.removeEventListener('mousemove', updatePosition);
                    document.removeEventListener('dragend', cleanup);
                    // Note: dragleave fires immediately when leaving source element, so don't use it
                    if (dragPreview.parentNode) {
                      dragPreview.parentNode.removeChild(dragPreview);
                    }
                  };
                  
                  document.addEventListener('mousemove', updatePosition);
                  document.addEventListener('dragend', cleanup);
                }}
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  padding: '4px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-elevated)',
                  border: selectedMediaId === item.id ? '1px solid var(--highlight-color)' : '1px solid var(--border-mid)',
                  cursor: 'pointer',
                  transition: 'border-color 0.15s, box-shadow 0.15s'
                }}
              >
                <div className="media-thumb" style={{ 
                  width: '100%', 
                  aspectRatio: '16/9', 
                  borderRadius: 'var(--radius-sm)', 
                  overflow: 'hidden',
                  marginBottom: '6px',
                  background: item.thumbnail ? `url(${item.thumbnail}) center/cover` : 'var(--bg-panel)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  {!item.thumbnail && (
                    item.type === 'audio' ? (
                      <Music size={28} className="text-green-400" />
                    ) : (
                      <Film size={28} className="text-blue-400" />
                    )
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 0 }}>
                  <div className="media-name" title={item.name} style={{ 
                    fontSize: 11, 
                    fontWeight: 500, 
                    whiteSpace: 'normal', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    lineHeight: 1.3,
                    maxHeight: '2.6em'
                  }}>
                    {item.name}
                  </div>
                  <div className="media-meta" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <TypeIcon type={item.type} />
                    <span>{formatDur(item.duration)}</span>
                  </div>
                </div>
                <button
                  className="media-remove"
                  onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                  title="Remove"
                  style={{ 
                    alignSelf: 'flex-end', 
                    marginTop: '4px',
                    opacity: 0,
                    transition: 'opacity 0.15s',
                    padding: '2px 6px'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
