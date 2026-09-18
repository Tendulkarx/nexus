import { describe, it, expect } from "vitest";

import { parseSshConfig } from "./ssh-config-parser.js";

const HOME = "/Users/test";

describe("parseSshConfig", () => {
  it("returns an empty list for empty contents", () => {
    expect(parseSshConfig("", HOME)).toEqual([]);
  });

  it("parses a single Host block with all fields", () => {
    const contents = `
Host prod
  HostName prod.example.com
  Port 2222
  User deploy
  IdentityFile ~/.ssh/prod_key
  ProxyJump bastion
`;
    expect(parseSshConfig(contents, HOME)).toEqual([
      {
        alias: "prod",
        hostName: "prod.example.com",
        port: 2222,
        user: "deploy",
        identityFile: "/Users/test/.ssh/prod_key",
        proxyJump: "bastion",
      },
    ]);
  });

  it("shares one block's settings across multiple space-separated aliases", () => {
    const contents = `
Host web1 web2
  HostName 10.0.0.1
  User admin
`;
    const hosts = parseSshConfig(contents, HOME);
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).toMatchObject({ alias: "web1", hostName: "10.0.0.1", user: "admin" });
    expect(hosts[1]).toMatchObject({ alias: "web2", hostName: "10.0.0.1", user: "admin" });
  });

  it("skips wildcard/pattern Host aliases", () => {
    const contents = `
Host *
  User defaultuser

Host 192.168.?.1
  User skipme

Host real-host
  HostName real.example.com
`;
    const hosts = parseSshConfig(contents, HOME);
    expect(hosts).toEqual([{ alias: "real-host", hostName: "real.example.com" }]);
  });

  it("ignores comments and blank lines", () => {
    const contents = `
# a comment

Host host1
  # another comment
  HostName host1.example.com

`;
    expect(parseSshConfig(contents, HOME)).toEqual([{ alias: "host1", hostName: "host1.example.com" }]);
  });

  it("ignores directives that appear before any Host line", () => {
    const contents = `
User orphan
Host host1
  HostName host1.example.com
`;
    expect(parseSshConfig(contents, HOME)).toEqual([{ alias: "host1", hostName: "host1.example.com" }]);
  });

  it("unquotes a quoted value", () => {
    const contents = `
Host host1
  IdentityFile "~/.ssh/my key"
`;
    expect(parseSshConfig(contents, HOME)).toEqual([
      { alias: "host1", identityFile: "/Users/test/.ssh/my key" },
    ]);
  });

  it("leaves an absolute IdentityFile path untouched", () => {
    const contents = `
Host host1
  IdentityFile /etc/ssh/keys/id_rsa
`;
    expect(parseSshConfig(contents, HOME)).toEqual([
      { alias: "host1", identityFile: "/etc/ssh/keys/id_rsa" },
    ]);
  });

  it("ignores an invalid Port value", () => {
    const contents = `
Host host1
  Port notanumber
`;
    expect(parseSshConfig(contents, HOME)).toEqual([{ alias: "host1" }]);
  });

  it("is case-insensitive for directive keys", () => {
    const contents = `
host host1
  hostname host1.example.com
  USER admin
`;
    expect(parseSshConfig(contents, HOME)).toEqual([
      { alias: "host1", hostName: "host1.example.com", user: "admin" },
    ]);
  });
});
