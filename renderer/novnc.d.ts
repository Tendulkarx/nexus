/** The slice of noVNC's RFB API (core/rfb.js, MPL-2.0) that vnc-pane.tsx uses; the package ships no types. */
declare module "@novnc/novnc" {
  export interface RfbCredentials {
    username?: string;
    password?: string;
    target?: string;
  }

  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | object,
      options?: { shared?: boolean; credentials?: RfbCredentials },
    );
    scaleViewport: boolean;
    clipViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    focusOnClick: boolean;
    background: string;
    /** Show a small dot when the server's cursor is fully transparent. */
    showDotCursor: boolean;
    /** 0–9; only affects lossy (JPEG-in-Tight) encodings. noVNC defaults to 6. */
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
    sendCredentials(credentials: RfbCredentials): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
    focus(): void;
  }
}
