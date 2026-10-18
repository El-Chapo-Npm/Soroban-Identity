import React from "react";

interface ViewTransitionProps {
  viewKey: string;
  children: React.ReactNode;
}

export const ViewTransition: React.FC<ViewTransitionProps> = ({ children }) => {
  return <div className="view-transition-container">{children}</div>;
};

export default ViewTransition;
