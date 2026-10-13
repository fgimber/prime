import { h, createContext } from 'preact';
import htm from 'htm';

export { h, render, Fragment, createContext } from 'preact';
export { useState, useEffect, useMemo, useCallback, useRef, useContext } from 'preact/hooks';
export const html = htm.bind(h);
export const AppCtx = createContext(null);
