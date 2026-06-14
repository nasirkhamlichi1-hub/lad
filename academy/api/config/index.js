// Tells the front-end that a backend is present, so it switches into
// "hosted" mode (login + central progress tracking). On GitHub Pages there is
// no /api, this 404s, and the app stays in local (localStorage) mode.
module.exports = async function (context) {
  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: { hosted: true }
  };
};
