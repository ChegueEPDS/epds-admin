const mongo=require('./effortController');
const postgres=require('./postgresEffortController');
const {databaseEngine}=require('../postgres');
const facade={};for(const name of Object.keys(postgres))facade[name]=(req,res,next)=>databaseEngine()==='postgresql'?postgres[name](req,res,next):mongo[name](req,res,next);
module.exports=facade;
