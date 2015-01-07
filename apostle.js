angular.module('apostle', ['restangular', 'base64']);

angular.module('apostle').run(['$apostle', '$cookieStore', function($apostle, $cookieStore){
	//set the api url soon as the module is loaded
	$apostle.setApiUrl($apostle.configuration.apiUrl);

	// set access token on page load if available in cookie
	if(angular.isDefined($cookieStore.get('accessToken'))){
		$apostle.setAccessToken($cookieStore.get('accessToken'));
	}
}]);

angular.module('apostle').provider('$apostle', function(){

	var configuration = {
		username: '',
		password: '',
		apiUrl:   '',
		clientId: null,
		clientSecret: null
	};

	apostleProvider = {
		setUsername: function (username) {
	    configuration.username = username;
	    return this;
	  },
		setPassword: function (password) {
	   	configuration.password = password;
	   	return this;
	  },
		setApiUrl: function (apiUrl) {
	    configuration.apiUrl = apiUrl;
	    return this;
	  },
		setClientId: function (clientId) {
	    configuration.clientId = clientId;
	    return this;
	  },
		setClientSecret: function (clientSecret) {
	    configuration.clientSecret = clientSecret;
	    return this;
	  },

		$get: ['$log', '$rootScope', 'Restangular', 'ApostleUtilService','$base64', '$q', '$cacheFactory', '$filter', '$cookieStore', '$http', function($log, $rootScope, Restangular, ApostleUtilService, $base64, $q, $cacheFactory, $filter, $cookieStore, $http){

			var connectionCache = $cacheFactory('connections');
			var companyCache    = $cacheFactory('companies');
			var userCache       = $cacheFactory('users');
			var feedCache       = $cacheFactory('feeds');
			var streamCache     = $cacheFactory('streams');
			var streamItemCache = $cacheFactory('streamsItemsitem');
			var currentCompany  = null;

			// initial config of Restangular
		  Restangular
		    .setRestangularFields({selfLink: '_links.self.href'})
		    .setDefaultHeaders({'Content-Type': 'application/json'})
		    .addRequestInterceptor(function(data, operation) {
		      if (operation === 'remove') {
		         return undefined;
		      } 
		      return data;
		    })
		    .addResponseInterceptor(function(data, operation, what, url, response) {
		      // look for getList and get operations
		      if (operation === 'getList' || operation === 'get' || operation === 'post') {

		        // return data if there's no data.data is available
		        if(!data.data){
			      	if(!data){
			     	 		data = {};
			      	}
			      	// add status to responsedata
		        	data._status = response.status;
		          return data;
		        }

		        // add links to response data
		        if(typeof data._links !== 'undefined'){
		          data.data._links = data._links;
		        }

		        // add pagination info to response data
		        if(typeof data._pagination !== 'undefined'){
		          data.data._pagination = data._pagination;
		        }

		        // add status to response data
		        data._status = response.status;

		        return data.data;
		      } else {
		      	data._status = response.status;
		        return data;
		      }
		    })
		    .setErrorInterceptor(function(response, deferred, responseHandler) {
		    	// if a 401 error is returned, refresh the token and replay the request before resolving the original restangular promise
			    if(response.status === 401) {
			      $apostle.oauthRefreshAccessToken().then(function(access_token) {
			      	// Repeat the request and then call the handlers the usual way.
			        // Be aware that no request interceptors are called this way.
			        response.config.params.access_token = access_token;
			        $http(response.config).then(responseHandler, deferred.reject);
			      });
						return false;
			    }
			    return true;
				});

		  // setup link shortner
			var shortner = Restangular.withConfig(function(RestangularConfigurer) {
		    RestangularConfigurer.setBaseUrl('http://apstl.es');
		  });


		  // private functions
		  // loops trough the paginated results from the API and returns the complete list of whatever is requested
		  var getAll = function(route, cache, company, query, mergedResponse, page){
		    var deferred = $q.defer();
		    if(!mergedResponse){
		      var mergedResponse = [];
		    }
		    if(!page){
		      var page = 0;
		    }

		    if(company){
					var queryObject = {page:page, limit:50, company: ApostleUtilService.extractId(company)}
		    }else{
					var queryObject = {page:page, limit:50}
		    }

		    if(query){
		    	queryObject = _.extend(queryObject, query);
		    }

		    Restangular.all(route).withHttpConfig({cache:cache}).getList(queryObject).then(
		      function(response){
		        mergedResponse = mergedResponse.concat(response); 
		        deferred.notify(mergedResponse);
		        if(response._pagination.page < response._pagination.page_count - 1){
		          getAll(route, cache, company, query, mergedResponse, page+1).then(
		            function(mergedResponse){
		              deferred.resolve(mergedResponse);
		            },
		            function(){
		              deferred.reject();
		            },
		            function(){
		              deferred.notify(mergedResponse);
		            }
		          )
		        }else{
		          deferred.resolve(mergedResponse);
		        }
		      }
		    );
		    return deferred.promise;
		  };

		  // add platform name & type to deal with the different type of connections from the same platform, 
		  var addPlatformType = function(connection){
				switch(connection.platform) {
					case 'facebook-page':
						connection.platformName = 'facebook';
						connection.platformType = 'page';
						break;
					case 'facebook':
						connection.platformName = 'facebook';
						connection.platformType = 'profile';
						break;
					case 'twitter':
						connection.platformName = 'twitter';
						connection.platformType = 'profile';
						break;
					case 'linkedin':
						connection.platformName = 'linkedin';
						connection.platformType = 'profile';
						break;
					case 'linkedin-page':
						connection.platformName = 'linkedin';
						connection.platformType = 'page';
						break;
					case 'google':
						connection.platformName = 'google';
						connection.platformType = 'profile';
						break;
					case 'google-analytics-profile':
						connection.platformName = 'google';
						connection.platformType = 'analytics-profile';
						break;
				} 
		  }

	  	$apostle = {
	  		configuration: configuration,

	  		// Logs in with username and password
	  		oauthLogin: function(username, password){
	  			var deferred  = $q.defer();
	  			var oauthData = {
	  				username:      username,
	  				password:      password,
	  				client_id:     configuration.clientId,
	  				client_secret: configuration.clientSecret,
	  				grant_type:    'password'
	  			}

					var pathArray = configuration.apiUrl.split( '/' );
					var tokenUrl  = pathArray[0] + '//' + pathArray[2] + '/oauth/v2/token';

	  			Restangular.oneUrl('oauth', tokenUrl).get(oauthData).then(
	  				function(response){
	  					$cookieStore.put('accessToken', response.access_token);
	  					$cookieStore.put('refreshToken', response.refresh_token);
	  					$apostle.setAccessToken(response.access_token);
	  					deferred.resolve();
	  				},
	  				function(){
	  					deferred.reject();
	  				}
	  			);

		      return deferred.promise; 
	  		},

	  		// logs user out
	  		oauthLogout: function(){
	  			$cookieStore.remove('accessToken');
	  			$cookieStore.remove('refreshToken');
					$apostle.setAccessToken('');
	  		},

	  		// refreshes access token
	  		oauthRefreshAccessToken: function(){
	  			var deferred  = $q.defer();
	  			var refreshToken = $cookieStore.get('refreshToken');

	  			// redirect to login if no refresh token is present
	  			if(refreshToken === undefined){
	  				deferred.reject();
	  			}else{
						var oauthData = {
		  				client_id:     configuration.clientId,
		  				client_secret: configuration.clientSecret,
		  				refresh_token: refreshToken,
		  				grant_type:    'refresh_token'
		  			}

		  		var pathArray = configuration.apiUrl.split( '/' );
					var tokenUrl  = pathArray[0] + '//' + pathArray[2] + '/oauth/v2/token';
		  			
		  			Restangular.oneUrl('oauth', tokenUrl).get(oauthData).then(
		  				function(response){
		  					$cookieStore.put('accessToken', response.access_token);
		  					$cookieStore.put('refreshToken', response.refresh_token);
		  					$apostle.setAccessToken(response.access_token);
		  					deferred.resolve(response.access_token);
		  				},
		  				function(){
		  					deferred.reject();
		  				}
		  			);
	  			}

		      return deferred.promise; 
	  		},

	  		// sets up restangular to use the access token
	  		setAccessToken: function(accessToken){
					Restangular.addFullRequestInterceptor(function(element, operation, route, url, headers, params, httpConfig) {
	    		  return {
	            params: _.extend(params, {access_token: accessToken})
	          };
		      });
	  		},




	  		/**************************************************************
				 * Depricated authentication method. 
				 * please use oauth instead
	  		 **************************************************************/
	  		// sets the username we use to connect to the api
	  		setUsername: function(username){
	  			configuration.username = username;
	  		},

	  		// sets the password we use to connect to the api
	  		setPassword: function(password){
	  			configuration.password = password;
	  		},
	  		// uses the username and password to create a basic auth token, and sets that token for all API calls
	  		setAuthorisation: function(username, password){
		      var token = $base64.encode(username+':'+password);
		      return this.setAuthorisationToken(token);
		    },
		    // sets the auth token for all API calls
	  		createAuthorisationToken: function(username, password){
	  			return $base64.encode(username+':'+password);
	  		},
		    // sets the auth token for all API calls
	  		setAuthorisationToken: function(token){
	  			return Restangular.setDefaultHeaders({'Authorization': 'Basic '+token});
	  		},
				/**************************************************************
				 * end of depricated authentication
	  		 **************************************************************/





	  		// sets API url for all api calls
	  		setApiUrl: function(apiUrl){
	  			configuration.apiUrl = apiUrl;
	  			Restangular.setBaseUrl(apiUrl);
	  		},

	  		// accepts company object or id. 
	  		// Save the current company in a global var and add a request interceptor
	  		setCurrentCompany: function(companyInput){
	  			//remove selected connections
	  			$cookieStore.remove('selectedConnectionIds')

	  			if(angular.isNumber(companyInput)){
	  				// immideately set id for the request interceptor
	  				currentCompany = {id:companyInput}
	  				// get the rest of the company
	  				$apostle.getCompany(companyInput).then(function(company){
	  					currentCompany = company;	      
				      $rootScope.$broadcast('CURRENTCOMPANY_CHANGED');
	  				});
	  			}else{
	  				// input is company object
						currentCompany = companyInput;	      
	  			}

	  			// set the request interceptor to use the new company ID
	  			Restangular.addFullRequestInterceptor(function(element, operation, route, url, headers, params, httpConfig) {
		    		// if a company param is already given, don't overwrite it.
		    		if(!angular.isDefined(params.company)){
		          return {
		            params: _.extend(params, {company: currentCompany.id})
		          };
		        }
		      });
					$rootScope.$broadcast('CURRENTCOMPANY_CHANGED');
	  		},

	  		// save the current company in a global var and add a request interceptor
	  		getCurrentCompany: function(){
	  			return currentCompany;	 
	  		},

	  		// returns the current user profile
	  		getProfile: function(){
	  			return Restangular.one("me").get({company:null});
	  		},

	  		// gets a single company
	  		getCompany: function(id, force){
	  			if(force){
		        companyCache.removeAll();
		      }
		      return Restangular.one('companies', id).withHttpConfig({cache:companyCache}).get();
	  		},

				// saves single company
				createCompany: function(company){
					return Restangular.one('companies').post('',company);
				},

	  		// delete a single company
	  		deleteCompany: function(company){
		      return Restangular.one('companies', ApostleUtilService.extractId(company)).remove();
	  		},

	  		// gets a single company
	  		getRootCompany: function(force){
	  			if(force){
		        companyCache.removeAll();
		      }
		      return Restangular.one('me').one('company').withHttpConfig({cache:companyCache}).get({company:null});
	  		},

	  		// gets all the connections the current user has access to. Set the first param truthy if you want to clear the cache and forc an API call
	  		getConnections: function(force, company){
	  			var deferred = $q.defer();

	  			if(force){
		        connectionCache.removeAll();
		      }
		      getAll('connections', connectionCache, company).then(
		      	function(connections){
			      	angular.forEach(connections, function(connection){
			      		addPlatformType(connection);
			      	});
							deferred.resolve($filter('filter')(connections, {state: '!'+1}));
			      	
			      },
			      function(){
			      	deferred.reject();
			      });
		      return deferred.promise; 
	  		},

	  		// gets all the feedas the current user has access to. Set the first param truthy if you want to clear the cache and forc an API call
	  		getFeeds: function(force){
	  			if(force){
		        feedCache.removeAll();
		      }
		      return getAll('feeds', feedCache);
	  		},

	  		// gets all the feedas the current user has access to. Set the first param truthy if you want to clear the cache and forc an API call
	  		getStreams: function(force, company){
	  			if(force){
		        streamCache.removeAll();
		      }
		      return getAll('streams', streamCache, company);
	  		},

	  		// gets all stream items for the array of connection id's
	  		getStreamItems: function(stream, connectionsIds, force, company){
	  			if(force){
		        streamItemCache.removeAll();
		      }
		      if(angular.isDefined(connectionsIds)){
		      	query = {connections:connectionsIds.join()}
		      }
		      return getAll('streams/'+stream+'/items', streamItemCache, company, query);
	  		},

	  		// gets the reconnect url for a given connection. 
	  		// Add a FULL redirect url, so the 3rd party knows where to redirect to after reconnecting
	  		getReconnectUrl: function(connection, redirect){
					var deferred = $q.defer();
		      Restangular.oneUrl('reconnectData', connection._links.reconnect.href+'&redirect='+encodeURIComponent(redirect)).get().then(
		        function (reconnectData) {
		          if(reconnectData._links.redirect){
		            deferred.resolve(reconnectData._links.redirect.href);
		          }else{
		            deferred.reject(false);
		          }
		        },
		        function(){
		          deferred.reject(false);
		        }
		      );
		      return deferred.promise;
	  		},
	  		// post a message
	  		postMessage: function(connection, message){
	  			return Restangular.one('connections', ApostleUtilService.extractId(connection)).post('',message);
	      },

	  		// reply to a message
	  		postReply: function(message, replyTo){
	  			return Restangular.oneUrl('reply', replyTo._links.reply.href).post('',message);
	  		},

				// approve message
				approveMessage: function(message){
					return Restangular.oneUrl('approve', message._links.approve.href).put();
				},

	  		// shorten links
				shortenLinks: function(text){
					return shortner.all('linkify').post({'text':text});
				},

	  		// post a message example
	  		getMessage: function(id){
					var deferred = $q.defer();
	  			// connection id is neccisary for url, but ignored when getting the message. Just use 0 for this.
		      Restangular.one('connections',0).one('messages',id).get().then(
		        function (message) {
		          addPlatformType(message.connection);
		          deferred.resolve(message);
		        },
		        function(){
		          deferred.reject(false);
		        }
		      );
		      return deferred.promise;
	  		},

	  		// uploads an image to the API and returns an object with a link to the image
	  		upload: function(attachment){
	  			var deferred = $q.defer();
		      if(attachment){
		        //get mimetype & 
		        var regex   = new RegExp('data:(.+);base64,(.+)', 'g');
		        var imgData = regex.exec(attachment);
		        var mime    = imgData[1];
		        var data    = imgData[2];

		        attachment = {
		          'name': '-',
		          'mime': mime,
		          'data': data
		        };
		        Restangular.one('uploads').post('',attachment).then(
		          function(response){
		            deferred.resolve(response);
		          },
		          function(){
		            deferred.reject();
		          }
		        );
		      }else{
		        deferred.reject(false);
		      }
		      return deferred.promise;
	  		},

	  		// saves the permissions for the given user on the given connection, 
	  		setPermissions: function(connection, user, permissions){
	  			
	  			if(!permissions._links){
	  				//save new
	  				var current = Restangular.one('connections', ApostleUtilService.extractId(connection)).one('permissions');
	      		current.permissions = permissions;
	      		current.user = ApostleUtilService.extractId(user);
	  				return current.save();
	  			}else{
	  				// save existing
	  				return permissions.save();
	  			}
	     		
	  		},

				// gets a specific user by id
	  		getUser: function(id, force){
	  			if(force){
		        userCache.removeAll();
		      }
		      return Restangular.one('users', id).withHttpConfig({cache:userCache}).get();
	  		},

	  		// saves a user for a specific company
	  		createUser: function(user, company){
	  			return Restangular.one('users').post('',user,{company:ApostleUtilService.extractId(company)});
	  		},

	  		// deletes a user
	  		deleteUser: function(user){
	  			return Restangular.one('users', ApostleUtilService.extractId(user)).remove();
	  		},

	  		// registers a company and it's first user
	  		register: function(user){
	  			var deferred = $q.defer();
	  			// connection id is neccisary for url, but ignored when getting the message. Just use 0 for this.
		      Restangular.one('register').post('',user).then(
		      	function(response){
		      		deferred.resolve();
	  				},
	  				function(response){
  						deferred.reject(response.status);	      		
	  				}
	  			)
		      return deferred.promise;
	  		},

	  		//saves an invitation to the API
	  		setInvitation: function(invitation, company){
					var deferred = $q.defer();
		      Restangular.one('social').one('invites').post('',invitation, {company:ApostleUtilService.extractId(company)} ).then(
	          function(response){
	            deferred.resolve(response);
	          },
	          function(){
	            deferred.reject();
	          }
	        );
	        return deferred.promise;
	  		}
	  		
	  	}
	  	return $apostle;
	  }]
	}

	return apostleProvider;
});

angular.module('apostle').factory('ApostleUtilService', ['$log', function ($log) {

  var ApostleUtilService = {
    extractId: function(input){
      if(typeof input == "number"){
        return input;
      }else if(typeof input == "string"){
        return parseInt(input);
      }else if(typeof input == "object" && input.id){
        return input.id;
      }else{
        $log.warn('Could not extract id. Type: '+ typeof input );
        return false;
      }
    }
  };

  return ApostleUtilService;
}]);