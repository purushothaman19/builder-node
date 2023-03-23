//jshint esversion:6
require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const session = require('express-session');
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require('mongoose-findorcreate');
const url = require('url');
const cors = require('cors');
const encodedParams = new URLSearchParams();
const axios = require("axios");
const  extract = require('pdf-text-extract');
const WebSocketServer = require('ws');
const { createServer } = require("http");
const { Server } = require("socket.io");

// Google Sheets
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');



// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials1.json');

const corsOptions ={
  origin:'*', 
  // credentials:true,            //access-control-allow-credentials:true
  optionSuccessStatus:200,
}

const app = express();
app.use(express.json());
app.use(cors(corsOptions));
app.use(express.static("public"));
app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({extended: true}));
app.use(bodyParser.json());

app.use(session({
  secret: "Our little secret.",
  resave: false,
  saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());


const httpServer = createServer();

const io = new Server(httpServer, {cors: {origin: "http://localhost:3001" }});


// const a = 'https://docs.google.com/spreadsheets/d/1Lf5ljekmd96XpVzXqD5KFZKJLG67vY8ieJ1NTLGZD7A/edit#gid=0';

mongoose.connect(`mongodb+srv://purush:${process.env.MONGO}@personalpurush.zmiac.mongodb.net/Exambird`, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then((result) => {
  console.log('connected to db');
  // console.log(result);
}).catch((err) => console.log(err));

// mongoose.set("useCreateIndex", true);

const userSchema = new mongoose.Schema ({
  username: String,
  email: String,
  password: String,
  googleId: String,
  secret: String,
  learner: Boolean,
  educator: Boolean,
  tests:Object,
  summary:Object
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function(user, done) {
  done(null, user.id);
});

passport.deserializeUser(function(id, done) {
  User.findById(id, function(err, user) {
    done(err, user);
  });
});

var currUser = {};
const currentdate = new Date(); 


passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: "https://exambuilder.netlify.app/auth/google/exambird",
    // userProfileURL: "https://www.googleapis.com/oauth2/v1/certs"
  },
  function(accessToken, refreshToken, profile, cb) {
    // console.log(profile);
    currUser=profile;

    const credentials = {
      googleId: profile.id, 
      username: profile.displayName, 
      email: profile.emails[0].value,
      educator: false,
    }

    User.findOrCreate(credentials, function (err, user) {
      return cb(err, user);
    });
  }
));

app.get("/auth/google",
  passport.authenticate('google', { scope: ["profile", "email"], prompt : "select_account" })
);

app.get("/auth/google/exambird",
  passport.authenticate('google', { failureRedirect: "/login" }),
  function(req, res) {
    // console.log(currUser.id);
    res.redirect("https://exambuilder.netlify.app/");
  });


app.get("/", function(req, res){
    res.send("<a href='login'>Login </a>");
});  

app.get("/login", function(req, res){
  console.log('login........');
  res.redirect("/auth/google");
});

app.get("/getUser", function(req, res){
  console.log({currUser});
  return res.json(currUser);
  // if (currUser!==undefined) res.json(currUser);
});

app.get('/validUser',function(req, res) { 
  console.log(Object.keys(currUser).length !== 0);
  return res.json(Object.keys(currUser).length !== 0)  
});

app.get("/logout", function(req, res){
  console.log('Wants to log out!!');
  currUser = {};
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/auth/google');
  });
});

app.post('/sheets', async function(req, resp){

  console.log(req.body);
  let DATA;
  const testName =  req.body.name;
  const sheetsID = req.body.link.split('/')[5];
  const duration = req.body.duration;
  console.log(sheetsID === undefined);

  if (sheetsID === undefined) return resp.status(401).json({ err:'Enter valid Link!' })

  async function loadSavedCredentialsIfExist() {
    try {
      const content = await fs.readFile(TOKEN_PATH);
      const credentials = JSON.parse(content);
      return google.auth.fromJSON(credentials);
    } catch (err) {
      return null;
    }
  }

  async function saveCredentials(client) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    const payload = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    });
    await fs.writeFile(TOKEN_PATH, payload);
  }

  async function authorize() {
    let client = await loadSavedCredentialsIfExist();
    if (client) return client;
    client = await authenticate({scopes: SCOPES,keyfilePath: CREDENTIALS_PATH});
    if (client.credentials) await saveCredentials(client);
    return client;
  }

  async function listMajors(auth) {
      let all =[];
      let data = {};

      console.log('ID: ' + sheetsID);
      const sheets = google.sheets({version: 'v4', auth});
      const res = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetsID,
          range: 'A2:G',
      }).catch(err => { console.log(err); return resp.status(400).json(err); })

      if(res.data !== undefined){
        const rows = res.data.values;
        DATA = rows;
    
        if (!rows || rows.length === 0) {
            console.log('No data found.');
            return resp.status(403).json({err:'no data found'});
        }

        console.log('Name, Major:');
        let answers = [];
        let correctAnswers = [];
        let numOfQues;

        rows.forEach((row, i) => {
          console.log(row[1],row[2],row[3],row[4]);

          answers.push(row[1],row[2],row[3],row[4]);
          row[5] = row[5].charAt(0).toUpperCase();
          correctAnswers.push(row[5].charCodeAt(0) - 65);

          let data = {
            question: row[0],
            options: answers,
          }

          all.push(data);
          answers=[];
          numOfQues++;
        });

        console.log(all);
        resp.status(200).json(all)

        var newDate = new Date(); 
        let final = {
          "quizTitle" : testName,
          "questions": all,
          'duration':duration,
          "correctAnswers": correctAnswers,
          'created':  newDate.getDate()+'/'+newDate.getMonth()+'/'+newDate.getFullYear()+' '
                    + newDate.getHours() + ":"  
                    + newDate.getMinutes() + ":" 
                    + newDate.getSeconds()
        };

        // upload-to-db-part

        const data = JSON.stringify(final);
        const testNum = `tests.${testName}`;
        // console.log(testFeild);
      
        const filter = { name: currUser.displayName };
        const update = { $set: { [testNum] : data } };
        const query = User.where({username: currUser.displayName })
        
        let doc = await query.findOneAndUpdate(filter, update ,{new: true});
        console.log(doc);

      }
    }

  authorize().then(listMajors).catch(console.error);
});


app.post("/login", function(req, res){

  const user = new User({
    username: req.body.username,
    password: req.body.password
  });

  req.login(user, function(err){
    if (err) {
      console.log(err);
    } else {
      passport.authenticate("local")(req, res, function(){
        res.redirect("/secrets");
      });
    }
  });

});


app.post("/text", function(req, res){  

  const text = req.body.text;
  const testName = req.body.name;
  const duration = req.body.duration;

  encodedParams.append("topic", "PrepAI Benefits");
  encodedParams.append("content", text);

  const options = {
    method: 'POST',
    url: 'https://prepai-generate-questions.p.rapidapi.com/getQuestions',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'X-RapidAPI-Key': '594a8029fbmshc4ba6f0f920fa3fp150942jsnab924774e8cc',
      'X-RapidAPI-Host': 'prepai-generate-questions.p.rapidapi.com'
    },
    data: encodedParams
  };

  res.status(200).json({0:'hello'});
  
  axios.request(options).then(function (response) {
    console.log(response.data);
    if(response.data){
      format(response.data.response);
    }
  }).catch(function (error) {
    console.error(error);
  });

  function format(data){
    const formattedQues = [];
    let opt = [];
    let correctAnswers = [];
  
    for(let i in data ){
      formattedQues[i]={};
      formattedQues[i]['question'] = data[i].question.join('\n').substring(7);
  
      for(let element in data[i].options){
        if(data[i].options[element].slice(-1)==='*'){ 
          data[i].options[element] = data[i].options[element].slice(0, -1);
          correctAnswers.push(String(Number(element)));
        }
        opt.push(data[i].options[element]);
      }
      formattedQues[i]['options']=opt;
      opt = [];
    };

    const newDate = new Date(); 

    let final = {
      "quizTitle" : testName,
      "questions": formattedQues,
      "correctAnswers": correctAnswers,
      'duration':duration,
      'created':  newDate.getDate()+'/'+newDate.getMonth()+'/'+newDate.getFullYear()+' '
                + newDate.getHours() + ":"  
                + newDate.getMinutes() + ":" 
                + newDate.getSeconds()
    };

    // console.log(testFeild);
    uploadDB();
  
    async function uploadDB(){
        const data = JSON.stringify(final);
        const testNum = `tests.${testName}`;

        const filter = { name: currUser.displayName };
        const update = { $set: { [testNum] : data } };
        const query = User.where({username: currUser.displayName })
      
        let doc = await query.findOneAndUpdate(filter, update ,{new: true});
        console.log(doc);
    }

    // fData = formattedQues;
    res.status(200).json(formattedQues);
  }
});


app.post('/postSummary', function(req, res){

  const testName = req.body.name;
  const marks = req.body.marks;
  const duration = req.body.duration;

  const newDate = new Date(); 
  const time =  newDate.getDate()+'/'+newDate.getMonth()+'/'+newDate.getFullYear()+' '
  + newDate.getHours() + ":"  
  + newDate.getMinutes() + ":" 
  + newDate.getSeconds()

  console.log( "time: " + time);
  const final = {
    marks     : marks,
    duration  : duration,
    time      : time
  }

  postSummary();
  async function postSummary(){

        // console.log(testName, marks, duration);

        console.log(currUser);
        const data = JSON.stringify(final);
        const testNum = `summary.${testName}.${time.replaceAll(' ','-')}`;
        console.log(testNum);
      
        const filter = { name: currUser.displayName };
        const update = { $set: { [testNum] : data }};
        console.log(update);
        const query = User.where({username: currUser.displayName })

        let doc = await query.findOneAndUpdate(filter, update, {new:true});
        // let doc = await query.findOneAndUpdate(filter, update, {new : true});
        console.log(doc);
        res.json(doc);
  }
  
})


app.get('/getSummary', async function(req, res){
  // const query = User.where({username:currUser.displayName})
  const query = User.where({username:currUser.displayName})
  let doc = await query.findOne();
  const tests = doc.summary;
  console.log(Object.keys(tests));
  console.log(doc);  
  return res.json(tests);
});


app.get('/getTests', async function(req, res){
  // const query = User.where({username:currUser.displayName})
  const query = User.where({username:currUser.displayName})
  let doc = await query.findOne();
  const tests = doc.tests;
  console.log(tests);
  // console.log(Object.keys(tests));
  // console.log(doc);  
  return res.json(tests);
})


app.get('/getTestNames', async function(req, res){
  const query = User.where({username:currUser.displayName})
  let doc = await query.findOne();
  const tests = doc.tests;
  if(tests) {
    var names = Object.keys(tests);
    return res.json(names);
  } 
  return res.json([]);
});


app.get('/user', async function(req, res){

  const data = JSON.stringify(fData);
  const testName = 'Hello';
  const testNum = `tests.${testName}`;
  // console.log(testFeild);

  const filter = { name: currUser.displayName};
  const update = { $set: { [testNum] : data } };
  const query = User.where({username:currUser.displayName})

  let doc = await query.findOneAndUpdate(filter, update ,{new: true});
  console.log(doc);
})

app.get('/test', function(req, res){

  const data = [
    {
    "topic": "PrepAI Benefits",
    "category_type": 1,
    "question": [
      "Ques  : What is the speed achieved by edtech leaders using prepai?"
    ],
    "options": [
      " 12X Speed *",
      "  10X Speed",
      " 6X Speed",
      " 8X Speed"
    ],
    "help_text": "Using prepai, the edtech leaders have achieved 12x speed in publishing."
  },
  {
    "topic": "PrepAI Benefits",
    "category_type": 2,
    "question": [
      "Ques  :  what is a popular example of a chat app?",
      " I.  Skype",
      " II. Telegram",
      " III. Facebook Messenger",
      " IV. Whatsapp ",
      "Which of the options given above is/are correct:"
    ],
    "options": [
      " II and I only.",
      " IV only.*",
      " IV, II and I only.",
      " III only."
    ],
    "help_text": "We have all encountered chat over the web, that can be facebook, instagram, whatsapp and the list goes on.just to give a bit of context, you send a message to a person or a group, they see the message and reply back."
  },
  {
    "topic": "PrepAI Benefits",
    "category_type": 4,
    "question": [
      "Ques  :  whatsapp is a popular example of a chat app."
    ],
    "options": [
      " True*",
      "  False"
    ],
    "help_text": "We have all encountered chat over the web, that can be facebook, instagram, whatsapp and the list goes on.just to give a bit of context, you send a message to a person or a group, they see the message and reply back."
  },]

  // data.options.forEach(element => {
  //   if(element.slice(-1)==='*'){ 
  //     // console.log(data.options.findIndex(element));
  //     console.log(element.slice(0, -1));
  //   }
  // });

  const formattedQues = [];
  let opt = [];

  for(let i in data ){
    formattedQues[i]={};
    formattedQues[i]['question'] = data[i].question.join('\n').substring(7);

    for(let element in data[i].options){
      if(data[i].options[element].slice(-1)==='*'){ 
        data[i].options[element] = data[i].options[element].slice(0, -1);
        formattedQues[i]['correctAnswer'] = element;
      }
      opt.push(data[i].options[element]);
    }
    formattedQues[i]['answers']=opt;
    opt = [];
  };

  res.status(200).json(formattedQues);
  console.log();
  console.log('-----------------------------------------------------------------------------');
});

// app.get('/api', function(req, res){})




// app.get('/test1', function(req, res){})

app.listen(3002, function() {
  console.log("Server started on port 3002.");
});

// httpServer.listen(3002, function(){
//   console.log("Server started on port 3002.");
// });
