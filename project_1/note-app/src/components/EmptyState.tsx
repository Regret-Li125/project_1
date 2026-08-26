import React from 'react';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

interface EmptyStateProps {
  message: string;
  description?: string;
  actions?: EmptyStateAction[];
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  message,
  description,
  actions,
  actionText,
  onAction,
}) => {
  return (
    <div className="empty-state">
      <p className="empty-title">{message}</p>
      {description && <p className="empty-description">{description}</p>}
      <div className="empty-actions">
        {actions?.map((action) => (
          <button
            key={action.label}
            className={`empty-action-btn ${action.variant || 'primary'}`}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
        {!actions && actionText && onAction && (
          <button className="empty-action-btn primary" onClick={onAction}>
            {actionText}
          </button>
        )}
      </div>
    </div>
  );
};
