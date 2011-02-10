
/**
 * Module dependencies.
 */

var express = require('express'),
    MemoryStore = require('connect').session.MemoryStore,
    io = require('socket.io'),
    sws = require('SessionWebSocket')(),
    twitter = require('./twitter').Twitter;
const crypto = require('crypto'),
      fs = require("fs");

var app = module.exports = express.createServer();

// Configuration

app.configure(function(){
  app.set('views', __dirname + '/views');
  app.use(express.cookieDecoder());
  app.use(express.session({ secret: 'himitsu', store: new MemoryStore({ reapInterval: 60000 * 10 }) }));
  app.use(sws.http);
  app.use(express.bodyDecoder());
  app.use(express.methodOverride());
  app.use(express.compiler({ src: __dirname + '/public', enable: ['less'] }));
  app.use(app.router);
  app.use(express.staticProvider(__dirname + '/public'));
  app.use(express.logger({ format: ':method :url' }));
});

app.configure('development', function(){
  express.logger("development node");
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function(){
  express.logger("production node");
  app.use(express.errorHandler()); 
});

// Routes

app.get('/', function(req, res){
  var jadeFile = 'login.jade';
  var loginMessage = "Login with Twitter!";
  var loginTo = "/login";
  var screenName = 'Twitter ID'
  if (req.session.oauth) {
    jadeFile = 'index.jade';
    loginMessage = "Logout";
    loginTo = "/logout";
    try{
      screenName = req.session.oauth._results.screen_name;
    }catch(e){
      console.error("screen_name ERROR: " + e);
      res.redirect('/');
    }
  }
  res.render(jadeFile, {
    locals: {
      title: 'designo',
      loginm: loginMessage,
      loginto: loginTo,
      screen_name: screenName
    }
  });
});

app.get('/login', function(req, res){
  authorize(req, res);
});

app.get('/logout', function(req, res){
  req.session.oauth = null;
  res.redirect('/');
});

app.get('/authorized', function(req, res){
  authorized(req, res);
});

// Only listen on $ node app.js

if (!module.parent) {
  //app.setSecure(credentials);
  app.listen(8080, "173.255.215.27");
  console.log("Express server listening on port %d", app.address().port);
}

// --- controllers
var consumerKey = "your consumer key";
var consumerSecret = "your consumer secret";

function authorize(req, res){
  var tw = new twitter(consumerKey, consumerSecret);
  tw.getRequestToken(function(error, self, url){
    if(error) {
      console.error(error);
      res.writeHead(500, {'Content-Type': 'text/html'});
      res.send('ERROR :' + error);
    }else {
      req.session.oauth = self;
      res.redirect(url);
    }
  });
}

// authorized callback from twitter.com
function authorized(req, res){
  if( !req.session.oauth ){
    res.redirect('/'); // invalid callback url access;
  } else {
    req.session.oauth.getAccessToken(req.query.oauth_verifier, function(error){
      if(error) {
        console.error(error);
        res.send(error);
      }else{
        res.redirect('/');
      }
    });
  }
}

var socket = io.listen(app);
socket.tid2sid = {}
socket.broadcastTo = function(message, to){ //to has to be an Array
  try {
    for (var i = 0, l = to.length; i < l; i++){
      if(this.tid2sid[to[i]]) this.clients[this.tid2sid[to[i]]].send(message);
    }
  }catch(e) {
    console.error("broadcastTo ERROR: "+e);
  }
  return this;
};
var count = 0;
var maxcount = 0;
socket.on('connection', sws.ws(function(client) {
  count++;
  client.broadcast({count: count});
  client.send({count: count});
  if(count>maxcount) console.log("maxcount: "+(maxcount=count));

  client.on('secure', function(){
    console.log("SECURE");
    var user = client.session.oauth;
    if(user) {
      try{
        socket.tid2sid[user._results.user_id] = client.sessionId;
      }catch(e){
        console.error('socket.tid2sid ERROR: ' + e);
      }
      //view home
      function scroll (page) {user.getTimeline(page, function(error, data, response){
          if(error) {
            console.error("TIMELLINE ERROR: " + error);
          } else{
            client.send({scroll: data});
          }
        });
      }
      scroll({page: 1});
      //user streams
      var params = {};
      var stream = user.openUserStream(params);
      stream.on('data', function(data){
        try{
          if(data.friends) {
          } else {
            client.send(data);
          }
        }catch(e){
          console.error('dispatch event ERROR: ' + e);
        }
      });
      stream.on('error', function(err){
        console.error('UserStream ERROR: ' + err);
        console.log('graceful restarting in 30 seconds');
        setTimeout("stream = user.openUserStream(params)", 3000);
      });
      stream.on('end', function(){
        console.log('UserStream ends successfully');
      });
      //manage followers
      user.followers(function(error, data, response){
        if(error) {
          console.error("FOLLOWERS ERROR: " + error);
        } else{
          client.followers = data;
        }
      });
    }

    client.on('message', function(message) {
      //message
      if(user) {
        if(message.text) {
          user.update(message, function(error, data, response){
            if(error) {
              console.error("UPDATE ERROR\ndata: "+data+"response: "+response+"oauth: "+user+"message: "+message);
            } else{
              client.send(data);
              socket.broadcastTo(data, client.followers);
            }
          });
        } else if(message.retweet){
          user.retweet(message.retweet.status.id_str, function(error, data, response){
            if(error) {
              console.error("RETWEET ERROR\ndata: "+data+"response: "+response+"oauth: "+user+"message: "+message);
            } else{
              client.send(data);
              socket.broadcastTo(data, client.followers);
            }
          });
        } else if(message.destroy){
          user.destroy(message.destroy.status.id_str, function(error, data, response){
            if(error) {
              console.error("DELETE ERROR\ndata: "+data+"response: "+response+"oauth: "+user+"message: "+message);
            }
          });
        } else if(message.scroll){
          scroll(message.scroll);
        }
      }
    });
  });
  client.on('insecure', function(){
    console.log("INSECURE");
  });
  client.on('disconnect', function() { //disconnect
    count--;
    client.broadcast({count: count});
  });
}));