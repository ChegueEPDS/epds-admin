const {databaseEngine}=require('../postgres');
module.exports=databaseEngine()==='postgresql'?require('./postgresAdminController'):require('./adminController');
