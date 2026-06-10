import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHashNavigationUrl, hashRouteMatches, normalizeHashRoute, splitHashUrl } from "./hash-navigation";

describe("hash-navigation", () => {
  it("splits hash routes from full urls", () => {
    assert.deepEqual(splitHashUrl("https://sit.dowalet.com/user/#/register"), {
      pageUrl: "https://sit.dowalet.com/user/",
      hash: "#/register"
    });
  });

  it("uses the last hash route when login url is concatenated with a deep link", () => {
    assert.deepEqual(
      splitHashUrl("http://localhost:5173/admin/#/admin/login#/admin/sys/perinfo"),
      {
        pageUrl: "http://localhost:5173/admin/",
        hash: "#/admin/sys/perinfo"
      }
    );
  });

  it("normalizes hash routes for vue hash history", () => {
    assert.equal(normalizeHashRoute("#/register"), "#/register");
    assert.equal(normalizeHashRoute("register"), "#/register");
  });

  it("builds full hash navigation urls", () => {
    assert.equal(
      buildHashNavigationUrl("https://sit.dowalet.com/user/", "#/register"),
      "https://sit.dowalet.com/user/#/register"
    );
  });

  it("matches equivalent hash paths", () => {
    assert.equal(hashRouteMatches("#/register", "#/register"), true);
    assert.equal(hashRouteMatches("#/login?redirect=%2Fdashboard", "#/login"), true);
    assert.equal(hashRouteMatches("#/login", "#/register"), false);
  });
});
