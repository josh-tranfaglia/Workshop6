// Imports the reverseString method from util.js
var utilModule = require('./util.js');
var reverseString = utilModule.reverseString;
// Imports the readDocument, writeDocument, and addDocument methods from database.js
var databaseModule = require('./database.js');
var readDocument = databaseModule.readDocument;
var writeDocument = databaseModule.writeDocument;
var addDocument = databaseModule.addDocument;
// Imports the schema for status updates.
var StatusUpdateSchema = require('./schemas/statusupdate.json');
// Imports the express Node module.
var express = require('express');
// Imports the validate function from express-jsonschema
var validate = require('express-jsonschema').validate;
// Imports the body-parser Node module
var bodyParser = require('body-parser');
// Creates an Express server.
var app = express();

// Support receiving text in HTTP request bodies
app.use(bodyParser.text());
// Support receiving JSON in HTTP request bodies
app.use(bodyParser.json());

// You run the server from `server`, so `../client/build` is `server/../clident/build`.
// '..' means "go up one directory", so this translates into `client/build`!
app.use(express.static('../client/build'));

// Defines what happens when it receives the `GET /` request
app.get('/', function (req, res) {
  res.send('Hello World!');
});


/**
 * Get the user ID from a token. Returns -1 (an invalud ID)
 * if it fails.
 */
function getUserIdFromToken(authorizationLine) {
  try {
    // Cut off "Bearer " from the header value.
    var token = authorizationLine.slice(7);
    // Convert the base64 string to a UTF-8 strin.
    var regularString = new Buffer(token, 'base64').toString('utf8');
    // Convert the UTF-8 string into a JavaScript object.
    var tokenObj = JSON.parse(regularString);
    var id = tokenObj['id'];
    // Check that id is a number.
    if (typeof id === 'number') {
      return id;
    } else {
      // Not a number. Return -1, an invalid ID.
      return -1;
    }
  } catch (e) {
    // Return an invalid ID.
    return -1;
  }
}

/**
 * Get the feed data for a particular user.
 */
app.get('/user/:userid/feed', function(req, res) {
  var userid = req.params.userid;
  var fromUser = getUserIdFromToken(req.get('Authorization'));
  // userid is a string. We need it to be a number.
  // Parameters are always strings.
  var useridNumber = parseInt(userid, 10);
  if (fromUser === useridNumber) {
    // Send response.
    res.send(getFeedData(userid));
  } else {
    // 401: Unauthorized request.
    res.status(401).end();
  }
});

// Handle POST /reverse [data]
app.post('/reverse', function (req, res) {
  // If the request came with text, then the text() middleware handled it
  // and made `req.body` a string.
  // Check that req.body is a string.
  if (typeof(req.body) === 'string') {
    var reverse = reverseString(req.body);
    res.send(reverse);
  } else {
    // POST did not contain a string. Send an error code back!
    res.status(400).end();
  }
});

/**
 * Resolves a feed item. Internal to the server, since it's synchronous.
 */
function getFeedItemSync(feedItemId) {
  var feedItem = readDocument('feedItems', feedItemId);
  // Resolve 'like' counter.
  feedItem.likeCounter = feedItem.likeCounter.map((id) => readDocument('users', id));
  // Assuming a StatusUpdate. If we had other types of FeedItems in the DB, we would
  // need to check the type and have logic for each type.
  feedItem.contents.author = readDocument('users', feedItem.contents.author);
  // Resolve comment author.
  feedItem.comments.forEach((comment) => {
    comment.author = readDocument('users', comment.author);
  });
  return feedItem;
}

/**
 * Emulates a REST call to get the feed data for a particular user.
 */
function getFeedData(user) {
  var userData = readDocument('users', user);
  var feedData = readDocument('feeds', userData.feed);
  // While map takes a callback, it is synchronous, not asynchronous.
  // It calls the callback immediately.
  feedData.contents = feedData.contents.map(getFeedItemSync);
  // Return FeedData with resolved references.
  return feedData;
}

/**
 * Adds a new status update to the database.
 */
function postStatusUpdate(user, location, contents) {
    // If we were implmenting this for real on an actual server, we would check
    // that the user ID is correct & matches the authenticated user. But since
    // we're mocking it, we can be less strict.

    // Get the current UNIX time.
    var time = new Date().getTime();
    // The new status update. The database will assign the ID for us.
    var newStatusUpdate = {
      "likeCounter": [],
      "type": "statusUpdate",
      "contents": {
        "author": user,
        "postDate": time,
        "location": location,
        "contents": contents,
        "likeCounter": []
      },
      // List of comments on the post
      "comments": []
    };

    // Add the status update to the database.
    // Returns the status update w/ an ID assigned.
    newStatusUpdate = addDocument('feedItems', newStatusUpdate);

    // Add the status update reference to the front of the current user's feed.
    var userData = readDocument('users', user);
    var feedData = readDocument('feeds', userData.feed);
    feedData.contents.unshift(newStatusUpdate._id);

    // Update the feed object.
    writeDocument('feeds', feedData);

    // Return the newly-posted object.
    return newStatusUpdate;
  }

  // `POST /feeditem { userId: user, location: location, contents: contents  }`
  app.post('/feeditem',
           validate({ body: StatusUpdateSchema }), function(req, res) {
    // If this function runs, `req.body` passed JSON validation!
    var body = req.body;
    var fromUser = getUserIdFromToken(req.get('Authorization'));

    // Check if requester is authorized to post this status update.
    // (The requester must be the author of the update.)
    if (fromUser === body.userId) {
      var newUpdate = postStatusUpdate(body.userId, body.location,
                                    body.contents);
      // When POST creates a new resource, we should tell the client about it
      // in the 'Location' header and use status code 201.
      res.status(201);
      res.set('Location', '/feeditem/' + newUpdate._id);
       // Send the update!
      res.send(newUpdate);
    } else {
      // 401: Unauthorized.
      res.status(401).end();
    }
  });

  /**
   * Translate JSON Schema Validation failures into error 400s.
   */
  app.use(function(err, req, res, next) {
    if (err.name === 'JsonSchemaValidation') {
      // Set a bad request http response status
      res.status(400).end();
    } else {
      // It's some other sort of error; pass it to next error middleware handler
      next(err);
    }
  });

// Starts the server on port 3000!
app.listen(3000, function () {
  console.log('Example app listening on port 3000!');
});
