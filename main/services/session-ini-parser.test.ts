import { describe, it, expect } from "vitest";

import { decodeIni, parseSessionIni, parseSessionLine } from "./session-ini-parser.js";

const SSH_LINE =
  " #109#0%10.0.10.11%22%root%%-1%-1%%bastion.lan%2222%jump%0%0%0%%%-1%0%0%0%%1080%%0%0%1#Font%10%0%0%-1%15%236,236,236%30,30,30%180,180,192%0%-1%0%%xterm%-1%-1%_Std_Colors_0_%80%24%0%1%-1%<none>%%0%1%-1#0# #-1";

describe("parseSessionLine", () => {
  it("reads type from the first % field, not the icon, plus host, port, user and SSH gateway", () => {
    expect(parseSessionLine("pve-01", SSH_LINE, ["Homelab"])).toEqual({
      name: "pve-01",
      folderPath: ["Homelab"],
      protocol: "ssh",
      typeCode: 0,
      host: "10.0.10.11",
      port: 22,
      username: "root",
      jumpHost: { host: "bastion.lan", port: 2222, username: "jump" },
    });
  });

  it("maps SFTP, RDP and VNC, and leaves undocumented types unmapped", () => {
    expect(parseSessionLine("files", " #140#7%nas.lan%22%oneil%%", [])?.protocol).toBe("sftp");
    expect(parseSessionLine("dc", " #91#4%10.0.10.50%3389%administrator%0%", [])).toMatchObject({
      protocol: "rdp",
      port: 3389,
      jumpHost: null,
    });
    expect(parseSessionLine("vnc", " #128#5%10.0.0.9%5900%%", [])).toMatchObject({ protocol: "vnc", port: 5900 });
    expect(parseSessionLine("telnet", " #98#1%switch.lan%23%%", [])).toMatchObject({ protocol: null, typeCode: 1 });
  });

  it("takes the first hop of a multi-hop gateway and treats -1 or blank ports as unset", () => {
    const line = " #109#0%host%-1%user%%-1%-1%%gw1__PIPE__gw2%22__PIPE__2200%a__PIPE__b%0";
    expect(parseSessionLine("x", line, [])).toMatchObject({
      port: null,
      jumpHost: { host: "gw1", port: 22, username: "a" },
    });
  });

  it("rejects lines without a session group or host", () => {
    expect(parseSessionLine("x", "garbage", [])).toBeNull();
    expect(parseSessionLine("x", " #109#0%%22%user", [])).toBeNull();
  });
});

describe("parseSessionIni", () => {
  it("reads every Bookmarks section with its folder path and ignores other sections", () => {
    const ini = [
      "[Misc]",
      "Something=#109#0%should-not-import%22%",
      "[Bookmarks]",
      "SubRep=",
      "ImgNum=42",
      `pve-01=${SSH_LINE}`,
      "[Bookmarks_1]",
      "SubRep=Homelab\\Proxmox",
      "ImgNum=41",
      "nas= #140#7%nas.lan%22%oneil%",
      "[Passwords]",
      "ssh22:root@10.0.10.11=encrypted-blob",
    ].join("\r\n");

    const sessions = parseSessionIni(ini);
    expect(sessions.map((s) => [s.name, s.folderPath, s.protocol])).toEqual([
      ["pve-01", [], "ssh"],
      ["nas", ["Homelab", "Proxmox"], "sftp"],
    ]);
  });
});

describe("decodeIni", () => {
  it("decodes UTF-8 (dropping a BOM) and falls back to Latin-1 for ANSI files", () => {
    expect(decodeIni(new Uint8Array([0xef, 0xbb, 0xbf, 0x63, 0x61, 0x66, 0xc3, 0xa9]))).toBe("café");
    expect(decodeIni(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
});
