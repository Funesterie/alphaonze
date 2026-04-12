import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import "./AtsRouletteBoard.css";
import { ROULETTE_AMOUNT_PRESETS } from "../model";

export type SelectedBet = {
  betType: string;
  betValue: string;
  label: string;
} | null;

export type PortAction = "http" | "https" | "app" | "ssh";

export type RoulettePortOccupant = {
  port: PortAction;
  userId: string;
  username: string;
  totalAmount: number;
  chipCount: number;
  tone: "red" | "green" | "amber" | "blue";
  isSelf?: boolean;
};

export type RoulettePlacedBet = {
  betType: string;
  betValue: string;
  amount: number;
  tone: "red" | "green" | "amber" | "blue";
  stackId?: string;
  offsetIndex?: number;
  isPreview?: boolean;
};

type AtsRouletteBoardProps = {
  feltImageSrc: string;
  chipImageSrc: string;
  amount: number;
  onAmountChange: (amount: number) => void;
  selectedBet: SelectedBet;
  selectedBetTone?: "red" | "green" | "amber" | "blue";
  placedBets?: RoulettePlacedBet[];
  onBetChange: (bet: NonNullable<SelectedBet>) => void;
  onClearBets?: () => void;
  clearDisabled?: boolean;
  portOccupants?: RoulettePortOccupant[];
  onPortClick?: (port: PortAction) => void;
  disabled?: boolean;
  debug?: boolean;
  className?: string;
};

const ATS_ROWS = [
  [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
  [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
  [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
] as const;

const ATS_COLUMN_BETS = [
  { betType: "column", betValue: "col3", label: "2 TO 1" },
  { betType: "column", betValue: "col2", label: "2 TO 1" },
  { betType: "column", betValue: "col1", label: "2 TO 1" },
] as const;

const ATS_DOZENS = [
  { betType: "dozen", betValue: "first12", label: "1ST 12" },
  { betType: "dozen", betValue: "second12", label: "2ND 12" },
  { betType: "dozen", betValue: "third12", label: "3RD 12" },
] as const;

const ATS_OUTSIDE = [
  { betType: "lowhigh", betValue: "low", label: "1 - 18", tone: "neutral" },
  { betType: "parity", betValue: "even", label: "EVEN", tone: "neutral" },
  { betType: "color", betValue: "red", label: "", tone: "red-diamond" },
  { betType: "color", betValue: "black", label: "", tone: "black-diamond" },
  { betType: "parity", betValue: "odd", label: "ODD", tone: "neutral" },
  { betType: "lowhigh", betValue: "high", label: "19 - 36", tone: "neutral" },
] as const;

const ATS_PORTS: ReadonlyArray<{
  id: PortAction;
  title: string;
  subtitle: string;
  tone: "red" | "green" | "amber" | "blue";
}> = [
  { id: "http", title: "PORT 80", subtitle: "HTTP", tone: "red" },
  { id: "https", title: "PORT 443", subtitle: "HTTPS", tone: "green" },
  { id: "app", title: "PORT 3000", subtitle: "APP", tone: "amber" },
  { id: "ssh", title: "PORT 22", subtitle: "SSH", tone: "blue" },
];

const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

function getNumberColor(value: number): "red" | "black" | "green" {
  if (value === 0) return "green";
  return RED_NUMBERS.has(value) ? "red" : "black";
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function getBetKey(betType: string, betValue: string) {
  return `${betType}::${betValue}`;
}

function getChipVariant(amount: number) {
  if (amount <= 10) return "v10";
  if (amount <= 50) return "v50";
  if (amount <= 200) return "v200";
  return "v500";
}

type RouletteBetAnchor = {
  left: number;
  top: number;
};

export default function AtsRouletteBoard({
  feltImageSrc,
  chipImageSrc,
  amount,
  onAmountChange,
  selectedBet,
  selectedBetTone = "amber",
  placedBets = [],
  onBetChange,
  onClearBets,
  clearDisabled = false,
  portOccupants = [],
  onPortClick,
  disabled = false,
  debug = false,
  className = "",
}: AtsRouletteBoardProps) {
  void chipImageSrc;
  const boardRef = useRef<HTMLDivElement | null>(null);
  const targetRefs = useRef(new Map<string, HTMLButtonElement>());
  const [betAnchors, setBetAnchors] = useState<Record<string, RouletteBetAnchor>>({});

  const measureBetAnchors = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;

    const boardRect = board.getBoundingClientRect();
    const nextAnchors: Record<string, RouletteBetAnchor> = {};

    targetRefs.current.forEach((node, key) => {
      const rect = node.getBoundingClientRect();
      nextAnchors[key] = {
        left: rect.left - boardRect.left + rect.width / 2,
        top: rect.top - boardRect.top + rect.height / 2,
      };
    });

    setBetAnchors(nextAnchors);
  }, []);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const rafId = window.requestAnimationFrame(measureBetAnchors);
    const resizeObserver = new ResizeObserver(() => {
      measureBetAnchors();
    });

    resizeObserver.observe(board);
    window.addEventListener("resize", measureBetAnchors);

    return () => {
      window.cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureBetAnchors);
    };
  }, [measureBetAnchors]);

  const registerBetTarget = useCallback(
    (betType: string, betValue: string) => (node: HTMLButtonElement | null) => {
      const key = getBetKey(betType, betValue);
      if (node) {
        targetRefs.current.set(key, node);
      } else {
        targetRefs.current.delete(key);
      }
    },
    [],
  );

  function isSelectedBet(betType: string, betValue: string) {
    return selectedBet?.betType === betType && selectedBet?.betValue === betValue;
  }

  function getPortOccupant(portId: PortAction) {
    return portOccupants.find((entry) => entry.port === portId) || null;
  }

  const visualStacks = useMemo(() => {
    const stackMap = new Map<
      string,
      {
        betType: string;
        betValue: string;
        amount: number;
        tone: "red" | "green" | "amber" | "blue";
        isPreview: boolean;
        offsetIndex: number;
      }
    >();

    placedBets.forEach((bet) => {
      const stackKey = bet.stackId || getBetKey(bet.betType, bet.betValue);
      if (bet.stackId) {
        stackMap.set(stackKey, {
          betType: bet.betType,
          betValue: bet.betValue,
          amount: bet.amount,
          tone: bet.tone,
          isPreview: Boolean(bet.isPreview),
          offsetIndex: Number(bet.offsetIndex || 0),
        });
        return;
      }

      stackMap.set(stackKey, {
        betType: bet.betType,
        betValue: bet.betValue,
        amount: bet.amount,
        tone: bet.tone,
        isPreview: Boolean(bet.isPreview),
        offsetIndex: Number(bet.offsetIndex || 0),
      });
    });

    if (selectedBet && !stackMap.has(getBetKey(selectedBet.betType, selectedBet.betValue))) {
      stackMap.set(getBetKey(selectedBet.betType, selectedBet.betValue), {
        betType: selectedBet.betType,
        betValue: selectedBet.betValue,
        amount,
        tone: selectedBetTone,
        isPreview: true,
        offsetIndex: 0,
      });
    }

    return [...stackMap.values()];
  }, [amount, placedBets, selectedBet, selectedBetTone]);

  return (
    <div ref={boardRef} className={cx("ats-roulette-board", debug && "is-debug", className)}>
      <img className="ats-roulette-board__felt" src={feltImageSrc} alt="" aria-hidden="true" />

      <div className="casino-roulette-board__stake-overlay" role="group" aria-label="Montant de mise">
        {ROULETTE_AMOUNT_PRESETS.map((preset) => (
          <button
            key={`overlay-${preset}`}
            type="button"
            className={cx("casino-roulette-stake-chip", amount === preset && "is-active")}
            onClick={() => onAmountChange(preset)}
            disabled={disabled}
            aria-pressed={amount === preset}
          >
            <span
              className={cx(
                "casino-roulette-stake-chip__coin",
                "roulette-coin",
                `roulette-coin--${selectedBetTone}`,
                `roulette-coin--${getChipVariant(preset)}`,
              )}
              aria-hidden="true"
            />
            <strong>{preset}</strong>
          </button>
        ))}
      </div>

      <div className="ats-roulette-board__surface">
        {(() => {
          const isActive = isSelectedBet("straight", "0");
          return (
        <button
          ref={registerBetTarget("straight", "0")}
          type="button"
          className={cx(
            "ats-roulette-cell",
            "ats-roulette-cell--zero",
            "ats-roulette-cell--green",
            isActive && "is-active",
          )}
          onClick={() =>
            onBetChange({ betType: "straight", betValue: "0", label: "Numero 0" })
          }
          aria-label="Numero 0"
          aria-pressed={isActive}
          disabled={disabled}
        >
          <span>0</span>
        </button>
          );
        })()}

        <div className="ats-roulette-board__numbers" role="grid" aria-label="Tapis ATS">
          {ATS_ROWS.map((row, rowIndex) => (
            <div key={`ats-row-${rowIndex}`} className="ats-roulette-board__row" role="row">
              {row.map((value) => {
                const isActive = isSelectedBet("straight", String(value));
                return (
                  <button
                    key={value}
                    ref={registerBetTarget("straight", String(value))}
                    type="button"
                    role="gridcell"
                    className={cx(
                      "ats-roulette-cell",
                      `ats-roulette-cell--${getNumberColor(value)}`,
                      isActive && "is-active",
                    )}
                    onClick={() =>
                      onBetChange({
                        betType: "straight",
                        betValue: String(value),
                        label: `Numero ${value}`,
                      })
                    }
                    aria-label={`Numero ${value}`}
                    aria-pressed={isActive}
                    disabled={disabled}
                  >
                    <span>{value}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="ats-roulette-board__columns">
          {ATS_COLUMN_BETS.map((bet) => {
            const isActive = isSelectedBet(bet.betType, bet.betValue);
            return (
              <button
                key={`${bet.betType}-${bet.betValue}`}
                ref={registerBetTarget(bet.betType, bet.betValue)}
                type="button"
                className={cx(
                  "ats-roulette-cell",
                  "ats-roulette-cell--column",
                  isActive && "is-active",
                )}
                onClick={() => onBetChange({ ...bet })}
                aria-label={bet.label}
                aria-pressed={isActive}
                disabled={disabled}
              >
                <span>{bet.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ats-roulette-board__dozens">
        {ATS_DOZENS.map((bet) => {
          const isActive = isSelectedBet(bet.betType, bet.betValue);
          return (
            <button
              key={`${bet.betType}-${bet.betValue}`}
              ref={registerBetTarget(bet.betType, bet.betValue)}
              type="button"
              className={cx(
                "ats-roulette-cell",
                "ats-roulette-cell--outside",
                "ats-roulette-cell--dozen",
                isActive && "is-active",
              )}
              onClick={() => onBetChange({ ...bet })}
              aria-label={bet.label}
              aria-pressed={isActive}
              disabled={disabled}
            >
              <span>{bet.label}</span>
            </button>
          );
        })}
      </div>

      <div className="ats-roulette-board__outside">
        {ATS_OUTSIDE.map((bet) => {
          const isActive = isSelectedBet(bet.betType, bet.betValue);
          const computedLabel =
            bet.betType === "color" && bet.betValue === "red"
              ? "Rouge"
              : bet.betType === "color" && bet.betValue === "black"
                ? "Noir"
                : bet.label;

          return (
            <button
              key={`${bet.betType}-${bet.betValue}`}
              ref={registerBetTarget(bet.betType, bet.betValue)}
              type="button"
              className={cx(
                "ats-roulette-cell",
                "ats-roulette-cell--outside",
                `ats-roulette-cell--outside-${bet.tone}`,
                isActive && "is-active",
              )}
              onClick={() =>
                onBetChange({
                  betType: bet.betType,
                  betValue: bet.betValue,
                  label: computedLabel,
                })
              }
              aria-label={computedLabel}
              aria-pressed={isActive}
              disabled={disabled}
            >
              {bet.tone === "red-diamond" ? <span className="ats-shape ats-shape--diamond" /> : null}
              {bet.tone === "black-diamond" ? <span className="ats-shape ats-shape--diamond ats-shape--diamond-black" /> : null}
              {bet.label ? <span>{bet.label}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="ats-roulette-board__clear">
        <button
          type="button"
          className="ats-roulette-cell ats-roulette-cell--outside ats-roulette-cell--outside-clear"
          onClick={() => onClearBets?.()}
          aria-label="Effacer les mises"
          disabled={disabled || clearDisabled}
        >
          <span className="ats-shape ats-shape--skull">☠</span>
        </button>
      </div>

      <div className="ats-roulette-board__bet-overlay" aria-hidden="true">
        {visualStacks.map((stack) => {
          const anchor = betAnchors[getBetKey(stack.betType, stack.betValue)];
          if (!anchor) return null;

          const coinVariant = getChipVariant(stack.amount);

          return (
            <span
              key={`${stack.betType}-${stack.betValue}-${stack.offsetIndex}`}
              className={cx(
                "ats-roulette-cell__stack",
                `ats-roulette-cell__stack--${stack.tone}`,
                stack.isPreview && "is-preview",
              )}
              style={{
                left: `${anchor.left + (((stack.offsetIndex % 3) - 1) * 14)}px`,
                top: `${anchor.top + (Math.floor(stack.offsetIndex / 3) * 10)}px`,
              }}
            >
              <span
                className={cx(
                  "ats-roulette-cell__stack-chip",
                  "roulette-coin",
                  `roulette-coin--${stack.tone}`,
                  `roulette-coin--${coinVariant}`,
                )}
              />
              <b>{stack.amount}</b>
            </span>
          );
        })}
      </div>

      <div className="ats-roulette-board__ports">
        {ATS_PORTS.map((port) => {
          const occupant = getPortOccupant(port.id);
          return (
            <button
              key={port.id}
              type="button"
              className={cx(
                "ats-port-button",
                `ats-port-button--${port.tone}`,
                occupant && "has-occupant",
                occupant?.isSelf && "is-self",
              )}
              onClick={() => onPortClick?.(port.id)}
              aria-label={`${port.title} ${port.subtitle}${occupant ? ` ${occupant.username} ${occupant.totalAmount}` : ""}`}
              disabled={disabled}
              title={occupant ? `${occupant.username} • ${occupant.totalAmount}` : `${port.title} ${port.subtitle}`}
            >
              {occupant ? (
                <>
                  <div className="ats-port-button__stack" aria-hidden="true">
                    {Array.from({ length: occupant.chipCount }, (_, index) => (
                      <span
                        key={`${occupant.userId}-${index}`}
                        className={cx("ats-port-chip", `ats-port-chip--${occupant.tone}`)}
                        style={{ ["--chip-offset" as string]: `${index * 4}px` }}
                      />
                    ))}
                  </div>
                  <div className="ats-port-button__meta">
                    <b>{occupant.username.slice(0, 10)}</b>
                    <small>{port.title} • {port.subtitle}</small>
                  </div>
                </>
              ) : (
                <>
                  <strong>{port.title}</strong>
                  <span>{port.subtitle}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
