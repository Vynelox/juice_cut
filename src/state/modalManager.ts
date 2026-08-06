export type ModalType = 'settings' | 'styles' | 'export' | 'torusMenuEditor' | 'playneedleEditor' | 'colorPicker' | 'rollDialog' | 'shaderSelector';

export interface ModalPermission {
  id: ModalType;
  canOpen: (state: ModalManagerState) => { allowed: boolean; reason?: string };
}

export interface ModalManagerState {
  openModals: Set<ModalType>;
  settings: {
    allowMultipleMenus: boolean;
    allowDuplicateMenus: boolean;
    allowEditsWhenMenuOpen: boolean;
  };
}

class ModalManager {
  private state: ModalManagerState = {
    openModals: new Set(),
    settings: {
      allowMultipleMenus: true,
      allowDuplicateMenus: false,
      allowEditsWhenMenuOpen: true,
    }
  };
  
  private permissions: Map<ModalType, ModalPermission> = new Map();
  private listeners: Set<(state: ModalManagerState) => void> = new Set();
  
  constructor() {
    // Initialize settings from localStorage so the manager reflects
    // persisted user preferences on app startup.
    try {
      const v = window.localStorage.getItem('juicecut.settings.allowMultipleMenus');
      if (v !== null) {
        this.state.settings.allowMultipleMenus = v === 'true';
      }
    } catch {}
    
    // Keep in sync with the rest of the app via the global settings-changed event.
    window.addEventListener('juicecut.settings-changed', ((e: CustomEvent) => {
      const { key, value } = e.detail;
      if (key in this.state.settings) {
        this.state.settings[key as keyof ModalManagerState['settings']] = value;
        this.notifyListeners();
      }
    }) as EventListener);
  }
  
  // Subscribe to state changes
  subscribe(listener: (state: ModalManagerState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  // Get current state
  getState(): ModalManagerState {
    return this.state;
  }
  
  // Register permission rules for a modal type (call once during init)
  registerPermission(permission: ModalPermission) {
    this.permissions.set(permission.id, permission);
  }
  
  // Update settings
  updateSettings(key: keyof ModalManagerState['settings'], value: boolean) {
    this.state.settings[key] = value;
    this.notifyListeners();
  }
  
  // Request to open a modal - returns whether it's allowed and optional reason
  requestOpen(modalType: ModalType): { allowed: boolean; reason?: string } {
    const permission = this.permissions.get(modalType);
    
    if (permission) {
      const result = permission.canOpen(this.state);
      if (!result.allowed) {
        return result;
      }
    }
    
    this.state.openModals.add(modalType);
    this.notifyListeners();
    
    // Push to global close stack for escape key handling
    // This will be handled by the calling component
    return { allowed: true };
  }
  
  // Close a modal
  close(modalType: ModalType) {
    this.state.openModals.delete(modalType);
    this.notifyListeners();
  }
  
  // Check if a specific modal is open
  isOpen(modalType: ModalType): boolean {
    return this.state.openModals.has(modalType);
  }
  
  // Check if any modal is open
  hasAnyOpen(): boolean {
    return this.state.openModals.size > 0;
  }
  
  // Get count of how many times a specific modal is open
  getOpenCount(modalType: ModalType): number {
    return Array.from(this.state.openModals).filter(m => m === modalType).length;
  }
  
  // Notify all listeners of state change
  private notifyListeners() {
    this.listeners.forEach(listener => listener(this.state));
  }
}

// Singleton instance
export const modalManager = new ModalManager();

// Export helper functions for global access
export const __canOpenModal = (): boolean => {
  return modalManager.getState().settings.allowMultipleMenus || !modalManager.hasAnyOpen();
};

export const __pushClose = (fn: () => void): void => {
  // This is kept for backwards compatibility with existing close stack
  // The modal manager handles this internally now
};

export const __popClose = (): void => {
  // Backwards compatibility
};

export const __peekClose = ((): (() => void) | null => {
  return null; // Deprecated - use modalManager instead
});

export const __isAnyModalOpen = (): boolean => {
  return modalManager.hasAnyOpen();
};