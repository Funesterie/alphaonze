import type { ReactNode } from "react";
import type { GameLayoutTemplate } from "../catalog";

type SceneHostProps = {
  template: GameLayoutTemplate;
  className?: string;
  main: ReactNode;
  sideLeft?: ReactNode;
  sideRight?: ReactNode;
  preview?: ReactNode;
  ambient?: ReactNode;
};

export default function SceneHost({
  template,
  className,
  main,
  sideLeft,
  sideRight,
  preview,
  ambient,
}: SceneHostProps) {
  return (
    <section className={`scene-host scene-host--${template}${className ? ` ${className}` : ""}`}>
      <div className="scene-host__main">{main}</div>
      {preview ? <div className="scene-host__preview">{preview}</div> : null}
      {sideLeft ? <div className="scene-host__side-left">{sideLeft}</div> : null}
      {sideRight ? <div className="scene-host__side-right">{sideRight}</div> : null}
      {ambient ? <div className="scene-host__ambient">{ambient}</div> : null}
    </section>
  );
}
