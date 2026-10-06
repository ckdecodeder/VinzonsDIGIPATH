const os = require('os');

function isIpv4(net) {
  return net.family === 'IPv4';
}

function getLanIpAddresses() {
  const ips = [];
  const nets = os.networkInterfaces();

  for (const ifaces of Object.values(nets)) {
    for (const net of ifaces || []) {
      if (isIpv4(net) && !net.internal) {
        ips.push(net.address);
      }
    }
  }

  return ips;
}

function getPrimaryLanIp() {
  const ips = getLanIpAddresses();
  const preferred = ips.find(
    (ip) =>
      ip.startsWith('192.168.')
      || ip.startsWith('10.')
      || /^172\.(1[6-9]|2\d|3[01])\./.test(ip),
  );

  return preferred || ips[0] || '127.0.0.1';
}

function formatServerUrls(port, label) {
  const lanIp = getPrimaryLanIp();
  const lines = [
    label,
    `  Local:   http://localhost:${port}`,
    `  Network: http://${lanIp}:${port}`,
  ];

  for (const ip of getLanIpAddresses()) {
    if (ip !== lanIp) {
      lines.push(`  Network: http://${ip}:${port}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  getLanIpAddresses,
  getPrimaryLanIp,
  formatServerUrls,
};
