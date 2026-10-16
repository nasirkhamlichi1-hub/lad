const { json } = require('../_shared');
module.exports = async function (context) { json(context, 200, { hosted: true }); };
