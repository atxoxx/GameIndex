import { createContext, useContext, type ReactNode } from "react";
import type { useEditGameController } from "./useEditGameController";

export type EditGameController = ReturnType<typeof useEditGameController>;

const EditGameContext = createContext<EditGameController | null>(null);

export function EditGameProvider({
  controller,
  children,
}: {
  controller: EditGameController;
  children: ReactNode;
}) {
  return (
    <EditGameContext.Provider value={controller}>
      {children}
    </EditGameContext.Provider>
  );
}

export function useEditGame(): EditGameController {
  const value = useContext(EditGameContext);
  if (!value) {
    throw new Error("useEditGame must be used inside EditGameProvider");
  }
  return value;
}
