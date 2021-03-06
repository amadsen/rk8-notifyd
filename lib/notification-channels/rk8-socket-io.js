"use strict";

var socket_io = require("socket.io");

function requestIdentification (context) {
  // Client flow, step 2. Notification Service requests identification
  context.client.emit('identify', {}, requestNotificationKey.bind(null, context));
}

// recieveNotificationKey
function requestNotificationKey (context, clientInfo) {
  var identity = clientInfo.id;
  // Client flow, step 7. Notification Service sends the
  // client-specific public key to Client
  context.getPublicKeyForClient(identity, function(err, clientPubKeyOpts){
    if (err) {
      return context.error(err, "Internal Error");
    }

    console.log("Client Public Key: ", clientPubKeyOpts, identity);
    context.client.emit(
      'key-exchange',
      clientPubKeyOpts,
      internalRecieveNotificationKey.bind(null, context, identity)
    );
  });
}

function internalRecieveNotificationKey (context, identity, notificationInfo) {
  return context.recieveNotificationKey (
    {
      identity: identity,
      notificationInfo: notificationInfo
    },
    function(err, encryptedResponse){
      if(err){
        return context.error(err, "Internal Error");
      }
      return requestAuthenticationCredentials(context, identity, encryptedResponse);
    }
  );
}

function requestAuthenticationCredentials (context, identity, encryptedResponse) {
  context.client.emit(
    'authenticate',
    encryptedResponse,
    context.completeRegistration.bind(null, identity)
  );
}

function send (client, details, msgObj, done) {
  var timeoutId;

  function handleAck (ackData){
    console.log('Clearing timeout id: ' +timeoutId);
    clearTimeout(timeoutId);
    return msgObj.ackFn(null, ackData);
  }

  // listen for acknowledgement id message (we use this API for consistency with
  // other non-socket.io sockets, which don't have an acknowledement function
  // built in.)
  if(msgObj.id && 'function' === typeof msgObj.ackFn){
    client.once(msgObj.id, handleAck);

    // To mitigate faulty clients, the ackFn listener will be
    // deleted after a timeout - 10 seconds by default.
    timeoutId = setTimeout(function (){
      // remove listener
      client.removeListener(msgObj.id, handleAck);

      // call our ackFn with a timeout error
      msgObj.ackFn(new Error('Acknowledgement timeout on socket ' + details.identity));
    }, msgObj.timeout || 10000);
    console.log('Setting timeout id: ' + timeoutId);
  }

  // Acknowledement MUST be decrypted in shared client sockets, not here
  client.emit('notification', msgObj.data);

  // send done when we have attempted to send the message,
  // Not when it is aknowledged.
  done();
}

module.exports = function configureSocketIoNotificationChannel (cfg) {
  return function establishSocketIoNotificationChannel (server, sharedSockets) {
    var io = socket_io(server);

    io.on('connection', function (client) {

      // listen for errors on the socket
      client.on('error', function (err) {
        console.error('Error on socket', err);
      });

      requestIdentification({
        client: client,
        getPublicKeyForClient: sharedSockets.getPublicKeyForClient,
        recieveNotificationKey: sharedSockets.recieveNotificationKey,
        completeRegistration: function(identity, credentials) {
          console.log('Recieved credentials in rk8-soket-io.js', credentials);

          var details = {
            identity: identity,
            credentials: credentials,
            socket: {}
          };
          // attach our send method to the socket
          details.socket.send = send.bind(null, client, details);

          sharedSockets.completeRegistration(details, function(err, clientInfo) {
              if (err) {
                // consider disconnecting client for load management purposes
                return console.error(err);
              }

              client.emit('authenticated', clientInfo.id);

              console.log("Successfully registered: ", clientInfo.id);
          });
        },
        error: function (err, msgToClient) {
          console.error(err);
          if(msgToClient){
            client.emit('error', msgToClient);
          }
        }
      });
    });
  };
}
