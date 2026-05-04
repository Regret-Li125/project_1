import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

type Command = {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
};

interface CommandPaletteProps {
  isOpen: boolean;
  commands: Command[];
  onClose: () => void;
  placeholder?: string;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  commands,
  onClose,
  placeholder = '输入命令...',
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = useMemo(
    () => commands.filter((cmd) =>
      cmd.label.toLowerCase().includes(query.toLowerCase())
    ),
    [commands, query]
  );

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  }, []);

  const handleClose = useCallback(() => {
    setQuery('');
    setSelectedIndex(0);
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredCommands.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
            handleClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          handleClose();
          break;
      }
    },
    [filteredCommands, selectedIndex, handleClose]
  );

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={handleClose}>
      <div className="command-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <ul className="command-palette-list">
          {filteredCommands.map((cmd, index) => (
            <li
              key={cmd.id}
              className={`command-palette-item ${index === selectedIndex ? 'selected' : ''}`}
              onClick={() => {
                cmd.action();
                handleClose();
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="command-label">{cmd.label}</span>
              {cmd.shortcut && (
                <span className="command-shortcut">{cmd.shortcut}</span>
              )}
            </li>
          ))}
          {filteredCommands.length === 0 && (
            <li className="command-palette-empty">没有匹配的命令</li>
          )}
        </ul>
      </div>
    </div>
  );
};
