const users = require('./userRepository');

module.exports = {
  findPasswordUser: (email) => users.findByEmail(email, { includePassword: true }),
  findMicrosoftUser: users.findByAzureId,
  saveUser: users.save
};
